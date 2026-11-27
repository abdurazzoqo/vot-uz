export interface AudioClip {
  id: string;
  start: number; // in video seconds
  end: number;   // in video seconds
  text: string;
  audioData: Float32Array;
  sampleRate: number;
  durationSec: number;
}

export interface IActiveSource {
  stop(): void;
  setPlaybackRate(rate: number): void;
}

export interface IAudioBackend {
  playClip(
    clip: AudioClip,
    playbackRate: number,
    volume: number,
    onEnded: () => void
  ): IActiveSource;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopAll(): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
}

export interface SyncControllerOptions {
  duckLevel: number;        // default 0.15
  dubbingVolume: number;    // default 1.0
  syncOffset: number;       // default 0.0 (-3..+3)
  slowVideoSync: boolean;   // default true
  preservePitch?: boolean;  // default true (prevents chipmunk/pitch shifting artifacts)
  normalVideoRate?: number; // default 1.0
  onDuckChange?: (duck: boolean, duckLevel: number) => void;
  onVideoRateAdjust?: (targetRate: number) => void;
  onSentenceStart?: (clip: AudioClip, lag: number, speedFactor: number) => void;
  onSentenceEnd?: (clip: AudioClip) => void;
  onClipDropped?: (clipId: string, lag: number) => void;
  audioBackend?: IAudioBackend;
}
