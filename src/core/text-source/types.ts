export interface TranslatedSentence {
  start: number;     // seconds from video start
  end: number;       // seconds from video start
  uz: string;        // Uzbek text in Latin script
  src_lang: string;  // Detected source language code
  src_text?: string; // Verbatim transcription of source speech
}

export type SourceType = 'SOURCE_A' | 'SOURCE_B';

export interface WindowRequestOptions {
  videoId: string;
  startSec: number;
  endSec: number;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  audioChunkWavBase64?: string;
  previousSentences?: TranslatedSentence[];
}

export interface TextSourceResult {
  sentences: TranslatedSentence[];
  sourceUsed: SourceType;
  latencyMs: number;
  fromCache?: boolean;
}

export interface TextSource {
  fetchWindow(options: WindowRequestOptions): Promise<TextSourceResult>;
}
