import { TextSource, WindowRequestOptions, TextSourceResult, TranslatedSentence, SourceType } from './types';
import { normalizeUzbekNumbers } from './number-normalizer';

const TRANSLATION_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      start: {
        type: 'NUMBER',
        description: 'Start timestamp in seconds'
      },
      end: {
        type: 'NUMBER',
        description: 'End timestamp in seconds'
      },
      src_lang: {
        type: 'STRING',
        description: 'Detected ISO 639-1 source language code (e.g. en, ru, tr, zh)'
      },
      src_text: {
        type: 'STRING',
        description: 'Verbatim transcription of the exact spoken speech in the original language. Must capture exact numbers and words spoken aloud by the voice.'
      },
      uz: {
        type: 'STRING',
        description: 'Natural spoken Uzbek translation in Latin script. Short sentences. Numbers/dates/units expanded into full Uzbek words. Non-Latin names transliterated into Uzbek Latin.'
      }
    },
    required: ['start', 'end', 'src_lang', 'src_text', 'uz']
  }
};

const SYSTEM_INSTRUCTION = `You are an expert dubbing translator and speech timer.
Your goal is to transcribe spoken speech from the audio track and dub it into natural spoken Uzbek in LATIN script.

Mandatory Rules:
1. AUDIO GROUNDING (CRITICAL):
   - Listen strictly to the SPOKEN VOICE in the audio track.
   - NEVER invent, alter, round, or substitute numbers based on on-screen text, graphics, slides, or UI overlays if they differ from what the speaker actually says aloud.
   - Transcribe into "src_text" the exact words and numbers uttered by the speaker.

2. COMPLETE CONTINUOUS COVERAGE (CRITICAL):
   - You MUST transcribe and translate ALL spoken speech throughout the ENTIRE time window from startOffset to endOffset without skipping or stopping early.
   - If the speaker talks throughout the window, you MUST output sequential sentence objects covering all speech up to the end of the window.
   - Do NOT stop after 3 or 4 sentences if there is more speech in the audio.

3. SENTENCE DURATION & CADENCE (CRITICAL):
   - Every sentence object MUST be a short, natural phrase or sentence.
   - A single item's duration (end - start) MUST NEVER exceed 8.0 seconds. NEVER output an item spanning 15, 30, or 60 seconds.
   - If a sentence is long, break it into smaller spoken clauses with individual start/end timestamps.
   - Keep Uzbek translation concise so that speaking it takes no more than 1.0 to 1.1x of the source sentence duration (end - start).
   - Return start and end timestamps in seconds with up to 2 decimal places.

4. MATHEMATICAL & NUMBER ACCURACY (CRITICAL):
   - Spoken numbers, statistics, amounts, money/currency, and dates MUST be translated with 100% mathematical precision.
   - NEVER confuse thousands ("ming") with millions ("million"), or hundreds ("yuz") with thousands ("ming"):
     * 733,000 / 733 тыс. -> "yetti yuz o'ttiz uch ming" (NEVER "ikki million" or anything else).
     * 2,100 / 2.1 тыс. / "две сто" -> "ikki ming bir yuz" (NEVER "o'n ikki ming").
     * 25,000 -> "yigirma besh ming".
     * 5 - 7 -> "besh dollardan yetti dollargacha" (or "beshdan yettigacha").
   - In colloquial speech (e.g. Russian "две сто" meaning 2,100, "полтора" meaning 1.5, "полмиллиона" meaning 500,000), interpret the exact intended numerical value and translate it accurately into Uzbek.
   - All numbers, money amounts, percentages, and units in "uz" MUST be written as full Uzbek words (e.g., "yetti yuz o'ttiz uch ming", "ikki ming bir yuz dollar", "o'n besh foiz", "yigirma besh ming dollar").

5. NATURAL SPOKEN UZBEK (LATIN SCRIPT):
   - The "uz" field MUST be in natural Uzbek Latin script (using o' and g' where appropriate).
   - Transliterate all non-Latin names and foreign terms accurately into phonetic Uzbek Latin script (e.g. "YouTube" -> "Yutyub", "Google" -> "Gugl").
   - Absolutely NO markdown (no asterisks, bold, italics), NO emojis, NO quotes, NO bullet points.

6. SOURCE LANGUAGE:
   - Auto-detect source language (src_lang). If speech is already in Uzbek, keep it in natural Latin Uzbek.`;

export class GeminiTextSource implements TextSource {
  private defaultModel: string;

  constructor(defaultModel: string = 'gemini-3.5-flash-lite') {
    this.defaultModel = defaultModel;
  }

  public async fetchWindow(options: WindowRequestOptions): Promise<TextSourceResult> {
    const { videoId, startSec, endSec, apiKey, model, signal, audioChunkWavBase64, previousSentences } = options;
    const modelToUse = model || this.defaultModel;

    // Try Source A first (YouTube URL with videoMetadata)
    try {
      const res = await this.callWithRetry(
        () => this.fetchSourceA(videoId, startSec, endSec, apiKey, modelToUse, previousSentences, signal),
        signal
      );
      return {
        sentences: res.sentences,
        sourceUsed: 'SOURCE_A',
        latencyMs: res.latencyMs
      };
    } catch (errA: any) {
      const isAbort = signal?.aborted || errA.name === 'AbortError' || errA.message === 'Aborted' || errA.message?.toLowerCase().includes('abort');
      if (isAbort) {
        throw errA;
      }
      console.warn('[VOT-UZ TextSource] Source A failed:', errA.message);

      // If Source B audio chunk is available, fallback to Source B
      if (audioChunkWavBase64) {
        console.log('[VOT-UZ TextSource] Falling back to Source B (Audio Chunk)...');
        const resB = await this.callWithRetry(
          () => this.fetchSourceB(audioChunkWavBase64, startSec, apiKey, modelToUse, previousSentences, signal),
          signal
        );
        return {
          sentences: resB.sentences,
          sourceUsed: 'SOURCE_B',
          latencyMs: resB.latencyMs
        };
      }

      throw errA;
    }
  }

  private async fetchSourceA(
    videoId: string,
    startSec: number,
    endSec: number,
    apiKey: string,
    model: string,
    previousSentences?: TranslatedSentence[],
    signal?: AbortSignal
  ): Promise<{ sentences: TranslatedSentence[]; latencyMs: number }> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let contextPrompt = `Listen strictly to the voice in the audio between ${startSec.toFixed(1)}s and ${endSec.toFixed(1)}s. Transcribe ALL spoken words across the full range [${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s] into "src_text", then translate accurately into Uzbek words in "uz". Every sentence must be <= 8.0s duration. Do not omit any spoken sentences.`;
    if (previousSentences && previousSentences.length > 0) {
      const recent = previousSentences.slice(-3).map(s => `[${s.start}s-${s.end}s]: "${s.uz}"`).join('\n');
      contextPrompt = `Previous sentences for context:\n${recent}\n\n` + contextPrompt;
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              fileData: {
                fileUri: videoUrl,
                mimeType: 'video/*'
              },
              videoMetadata: {
                startOffset: `${Math.floor(startSec)}s`,
                endOffset: `${Math.ceil(endSec)}s`
              }
            },
            { text: contextPrompt }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: TRANSLATION_RESPONSE_SCHEMA,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      }
    };

    const t0 = performance.now();
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const latencyMs = performance.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (resp.status === 400 && (text.includes('empty') || text.includes('corrupted') || text.includes('malformed'))) {
        console.warn(`[VOT-UZ TextSource] End of video or empty segment at [${startSec}s - ${endSec}s], treating as silence.`);
        return { sentences: [], latencyMs: performance.now() - t0 };
      }
      throw new Error(`Gemini HTTP ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    const sentences = this.parseAndFilterSentences(rawText, startSec, endSec);

    return { sentences, latencyMs };
  }

  private async fetchSourceB(
    audioChunkWavBase64: string,
    chunkStartOffsetSec: number,
    apiKey: string,
    model: string,
    previousSentences?: TranslatedSentence[],
    signal?: AbortSignal
  ): Promise<{ sentences: TranslatedSentence[]; latencyMs: number }> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    let contextPrompt = `Listen strictly to the voice in this audio chunk. Transcribe ALL spoken words into "src_text", then translate accurately into Uzbek words in "uz". Every sentence must be <= 8.0s duration. Do not omit any spoken sentences.`;
    if (previousSentences && previousSentences.length > 0) {
      const recent = previousSentences.slice(-3).map(s => `[${s.start}s-${s.end}s]: "${s.uz}"`).join('\n');
      contextPrompt = `Previous sentences for context:\n${recent}\n\n` + contextPrompt;
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: audioChunkWavBase64
              }
            },
            { text: contextPrompt }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: TRANSLATION_RESPONSE_SCHEMA,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      }
    };

    const t0 = performance.now();
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const latencyMs = performance.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (resp.status === 400 && (text.includes('empty') || text.includes('corrupted') || text.includes('malformed'))) {
        console.warn(`[VOT-UZ TextSource] End of video or empty segment at offset ${chunkStartOffsetSec}s, treating as silence.`);
        return { sentences: [], latencyMs: performance.now() - t0 };
      }
      throw new Error(`Gemini HTTP ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    let sentences = this.parseAndFilterSentences(rawText, 0, 999999);

    // Apply chunkStartOffsetSec
    sentences = sentences.map(s => ({
      ...s,
      start: Number((s.start + chunkStartOffsetSec).toFixed(2)),
      end: Number((s.end + chunkStartOffsetSec).toFixed(2))
    }));

    return { sentences, latencyMs };
  }

  private parseAndFilterSentences(rawText: string | undefined, minStart: number, maxEnd: number): TranslatedSentence[] {
    if (!rawText) return [];
    try {
      const list = JSON.parse(rawText);
      if (!Array.isArray(list)) return [];
      return list
        .filter(item => typeof item.start === 'number' && typeof item.end === 'number' && typeof item.uz === 'string')
        .map(item => {
          const start = Number(item.start.toFixed(2));
          let end = Number(item.end.toFixed(2));
          // Safety cap: if an item covers more than 8 seconds, cap end to prevent blocking buffer calculation
          if (end - start > 8.0) {
            const wordCount = (item.uz || '').trim().split(/\s+/).length;
            const estimatedSec = Math.max(3.0, Math.min(8.0, wordCount * 0.45));
            end = Number((start + estimatedSec).toFixed(2));
          }
          return {
            start,
            end: Math.max(start + 0.5, end),
            uz: normalizeUzbekNumbers(item.uz.trim()),
            src_lang: (item.src_lang || 'en').toLowerCase(),
            ...(item.src_text ? { src_text: String(item.src_text).trim() } : {})
          };
        })
        // A sentence belongs to the window in which it starts
        .filter(s => s.start >= minStart - 0.5 && s.start < maxEnd + 0.5);
    } catch {
      return [];
    }
  }

  private async callWithRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, maxRetries = 2): Promise<T> {
    let delay = 500;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        return await fn();
      } catch (err: any) {
        if (attempt === maxRetries || signal?.aborted) {
          throw err;
        }
        const isRetryable = err.message?.includes('503') || err.message?.includes('429') || err.message?.includes('UNAVAILABLE');
        if (!isRetryable) {
          throw err;
        }
        console.warn(`[VOT-UZ TextSource] Retryable error (${err.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // exponential backoff
      }
    }
    throw new Error('Exceeded max retries');
  }
}
