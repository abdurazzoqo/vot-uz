import { Gapiring } from 'gapiring';
import { ModelCacheManager } from '@/core/tts/model-cache';
import { normalizeUzbekNumbers } from '@/core/text-source/number-normalizer';

console.log('[VOT-UZ Offscreen] TTS engine initializing...');

let ttsInstance: Gapiring | null = null;
let isWarmedUp = false;
let isSubtitlesOnlyFallback = false;
let lastSpeedFactor: number | null = null;
const cacheManager = new ModelCacheManager();

// Install caching fetch globally so Gapiring uses Cache API automatically
globalThis.fetch = cacheManager.createCachingFetch((progress) => {
  console.log(`[VOT-UZ Offscreen] Downloading ${progress.file}: ${progress.percent}% (${(progress.loaded / 1024 / 1024).toFixed(1)} MB)`);
});

async function loadAndWarmUp(): Promise<{ speedFactor: number; subtitlesOnly: boolean }> {
  if (ttsInstance && isWarmedUp) {
    return { speedFactor: lastSpeedFactor ?? 2.5, subtitlesOnly: isSubtitlesOnlyFallback };
  }

  console.log('[VOT-UZ Offscreen] Loading Gapiring model...');
  const t0 = performance.now();
  ttsInstance = await Gapiring.load({
    model: 'edge'
  });
  console.log(`[VOT-UZ Offscreen] Model loaded in ${(performance.now() - t0).toFixed(0)} ms`);

  // Warm-up dummy synthesis & RTF benchmark
  console.log('[VOT-UZ Offscreen] Running warm-up synthesis...');
  const tWarm0 = performance.now();
  const testText = "Salom, tizim tekshiruvi muvaffaqiyatli yakunlandi.";
  const audio = await ttsInstance.speak(testText, {
    voice: 'f1',
    role: 'assistant',
    manner: 'neutral'
  });
  const tWarmDone = performance.now();

  const synthTimeSec = (tWarmDone - tWarm0) / 1000;
  const audioDurationSec = audio.length / 24000;
  const speedFactor = audioDurationSec / Math.max(0.001, synthTimeSec);
  lastSpeedFactor = speedFactor;

  console.log(`[VOT-UZ Offscreen] Warm-up done: ${audioDurationSec.toFixed(2)}s audio synthesized in ${synthTimeSec.toFixed(2)}s (${speedFactor.toFixed(2)}x RTF)`);

  // Check 1.2x threshold requirement
  if (speedFactor < 1.2) {
    console.warn(`[VOT-UZ Offscreen] TTS speed factor (${speedFactor.toFixed(2)}x) is below 1.2x threshold. Falling back to subtitles-only.`);
    isSubtitlesOnlyFallback = true;
  } else {
    isSubtitlesOnlyFallback = false;
  }

  isWarmedUp = true;
  return { speedFactor, subtitlesOnly: isSubtitlesOnlyFallback };
}

// Mutex queue to guarantee strictly sequential ONNX WebAssembly synthesis
let synthesisChain: Promise<any> = Promise.resolve();
function queueSynthesis<T>(fn: () => Promise<T>): Promise<T> {
  const task = synthesisChain.then(fn, fn);
  synthesisChain = task.catch(() => {});
  return task;
}

// Listen for runtime messages from background and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TTS_WARMUP') {
    loadAndWarmUp()
      .then((res) => {
        sendResponse({
          ok: true,
          speedFactor: res.speedFactor,
          subtitlesOnly: res.subtitlesOnly
        });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'TTS_SYNTHESIZE') {
    queueSynthesis(async () => {
      try {
        if (!ttsInstance) {
          await loadAndWarmUp();
        }

        if (isSubtitlesOnlyFallback) {
          sendResponse({
            ok: false,
            subtitlesOnly: true,
            message: 'TTS speed below 1.2x: falling back to subtitles-only'
          });
          return;
        }

        const { sentenceId, text, voice } = message;
        const normalizedText = normalizeUzbekNumbers(text);
        console.log(`[VOT-UZ Offscreen] Synthesizing ${sentenceId}: "${normalizedText}"`);
        const t0 = performance.now();
        const audio = await ttsInstance!.speak(normalizedText, {
          voice: voice || 'f1',
          role: 'assistant',
          manner: 'neutral'
        });
        const latencyMs = performance.now() - t0;
        const duration = audio.length / 24000;
        console.log(`[VOT-UZ Offscreen] Synthesized ${sentenceId} in ${latencyMs.toFixed(0)}ms (${duration.toFixed(2)}s audio)`);

        // Convert Float32Array to standard array for message transmission
        const audioArray = Array.from(audio);
        sendResponse({
          ok: true,
          sentenceId,
          audioData: audioArray,
          sampleRate: 24000,
          duration,
          latencyMs
        });
      } catch (err: any) {
        console.error(`[VOT-UZ Offscreen] Failed synthesizing ${message.sentenceId}:`, err);
        sendResponse({ ok: false, error: err.message });
      }
    });
    return true;
  }

  if (message.type === 'TTS_CANCEL') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
