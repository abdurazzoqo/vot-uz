import { AudioClip, IActiveSource, IAudioBackend, SyncControllerOptions } from './types';
import { WebAudioBackend } from './web-audio-backend';

export class AudioSyncController {
  private queue: AudioClip[] = [];
  private audioBackend: IAudioBackend;
  private options: SyncControllerOptions;
  private currentPlayingClip: AudioClip | null = null;
  private currentActiveSource: IActiveSource | null = null;
  private prevClipEndVideoTime: number = 0;
  private isPaused: boolean = false;
  private isDucked: boolean = false;
  private unduckTimeoutId: any = null;
  private isDeceleratingVideo: boolean = false;
  private normalVideoRate: number = 1.0;

  // Lag metrics
  private currentLag: number = 0;
  private recentLags: number[] = [];

  constructor(options?: Partial<SyncControllerOptions>) {
    this.options = {
      duckLevel: options?.duckLevel ?? 0.15,
      dubbingVolume: options?.dubbingVolume ?? 1.0,
      syncOffset: options?.syncOffset ?? 0.0,
      slowVideoSync: options?.slowVideoSync ?? true,
      preservePitch: options?.preservePitch ?? true,
      normalVideoRate: options?.normalVideoRate ?? 1.0,
      onDuckChange: options?.onDuckChange,
      onVideoRateAdjust: options?.onVideoRateAdjust,
      onSentenceStart: options?.onSentenceStart,
      onSentenceEnd: options?.onSentenceEnd,
      onClipDropped: options?.onClipDropped,
      audioBackend: options?.audioBackend
    };

    this.normalVideoRate = this.options.normalVideoRate ?? 1.0;
    this.audioBackend = this.options.audioBackend ?? new WebAudioBackend();
  }

  public setOptions(options: Partial<SyncControllerOptions>): void {
    if (options.duckLevel !== undefined) this.options.duckLevel = options.duckLevel;
    if (options.dubbingVolume !== undefined) {
      this.options.dubbingVolume = options.dubbingVolume;
      this.audioBackend.setVolume(options.dubbingVolume);
    }
    if (options.syncOffset !== undefined) this.options.syncOffset = options.syncOffset;
    if (options.slowVideoSync !== undefined) this.options.slowVideoSync = options.slowVideoSync;
    if (options.preservePitch !== undefined) this.options.preservePitch = options.preservePitch;
    if (options.normalVideoRate !== undefined) {
      this.normalVideoRate = options.normalVideoRate;
      this.options.normalVideoRate = options.normalVideoRate;
    }
  }

  public addClip(clip: AudioClip): void {
    if (this.queue.some(c => c.id === clip.id)) {
      return; // Deduplicate identical ID
    }
    // Prevent overlapping competing clips
    const hasOverlap = this.queue.some(c => {
      const overlapStart = Math.max(c.start, clip.start);
      const overlapEnd = Math.min(c.end, clip.end);
      const overlapDur = overlapEnd - overlapStart;
      const minDur = Math.min(c.end - c.start, clip.end - clip.start);
      return Math.abs(c.start - clip.start) < 1.0 || (minDur > 0 && overlapDur / minDur > 0.4);
    });
    if (hasOverlap) {
      return; // Drop overlapping synonym clip
    }
    this.queue.push(clip);
    this.queue.sort((a, b) => a.start - b.start);
  }

  public addClips(clips: AudioClip[]): void {
    for (const c of clips) {
      this.addClip(c);
    }
  }

  public tick(videoTime: number, videoRate: number = 1.0, isVideoPaused: boolean = false): void {
    if (isVideoPaused) {
      if (!this.isPaused) {
        this.isPaused = true;
        this.audioBackend.pause();
      }
      return;
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.audioBackend.resume();
    }

    // Process queue
    while (this.queue.length > 0) {
      const nextClip = this.queue[0];
      const effectiveStart = nextClip.start + this.options.syncOffset;

      // Has video reached this clip yet?
      if (videoTime < effectiveStart) {
        break; // Not yet time for nextClip
      }

      // Layer 3: If a clip is currently playing, wait for it to finish
      if (this.currentPlayingClip !== null) {
        break;
      }

      // Scheduled start aligns with max(effectiveStart, prevClipEnd)
      const scheduledStart = Math.max(effectiveStart, this.prevClipEndVideoTime);
      const lag = Math.max(0, videoTime - scheduledStart);

      // Layer 5: If lag > 4.0s, drop clip and resync cleanly
      if (lag > 4.0) {
        this.queue.shift();
        this.options.onClipDropped?.(nextClip.id, lag);
        continue;
      }

      // Clip is ready to play!
      this.queue.shift();
      this.playClip(nextClip, videoTime, videoRate, lag);
      break;
    }

    // Check Layer 4: Temporary video deceleration
    this.checkVideoDeceleration(videoRate);
  }

  private playClip(clip: AudioClip, videoTime: number, videoRate: number, lag: number): void {
    this.currentPlayingClip = clip;
    this.currentLag = lag;
    this.recordLag(lag);

    // Cancel pending unduck if another clip started
    if (this.unduckTimeoutId) {
      clearTimeout(this.unduckTimeoutId);
      this.unduckTimeoutId = null;
    }
    this.setDucking(true);

    // Layer 2: Clip speedup
    const naturalDuration = clip.durationSec;
    const windowDuration = Math.max(0.4, clip.end - clip.start);
    const availableTime = Math.max(0.3, (clip.end + this.options.syncOffset) - videoTime);

    // Layer 2: Fast speaker matching & lag catch-up (pitch is preserved natively)
    let speedFactor = 1.0;
    if (naturalDuration > windowDuration || lag > 0.15) {
      const targetWindow = Math.max(0.3, Math.min(windowDuration, availableTime));
      const ratio = naturalDuration / targetWindow;
      speedFactor = Math.min(1.40, Math.max(1.0, ratio));
    }

    const effectivePlaybackRate = speedFactor * videoRate;

    this.options.onSentenceStart?.(clip, lag, speedFactor);

    this.currentActiveSource = this.audioBackend.playClip(
      clip,
      effectivePlaybackRate,
      this.options.dubbingVolume,
      () => {
        this.onClipFinished(clip, videoTime + naturalDuration / speedFactor);
      }
    );
  }

  private onClipFinished(clip: AudioClip, estimatedVideoEndTime: number): void {
    if (this.currentPlayingClip?.id === clip.id) {
      this.currentPlayingClip = null;
      this.currentActiveSource = null;
      this.prevClipEndVideoTime = estimatedVideoEndTime;
      this.options.onSentenceEnd?.(clip);

      // Keep original video ducked during active dubbing playback so video audio
      // does not self-increase between sentences and drown out dubbing.
    }
  }

  private setDucking(duck: boolean): void {
    if (this.isDucked !== duck) {
      this.isDucked = duck;
      this.options.onDuckChange?.(duck, this.options.duckLevel);
    }
  }

  private checkVideoDeceleration(currentVideoRate: number): void {
    if (!this.options.slowVideoSync) {
      if (this.isDeceleratingVideo) {
        this.isDeceleratingVideo = false;
        this.options.onVideoRateAdjust?.(this.normalVideoRate);
      }
      return;
    }

    // Trigger deceleration if lag > 1.5s
    if (this.currentLag > 1.5 && !this.isDeceleratingVideo) {
      this.isDeceleratingVideo = true;
      this.options.onVideoRateAdjust?.(this.normalVideoRate * 0.94);
    } else if (this.currentLag < 0.3 && this.isDeceleratingVideo) {
      // Hysteresis: restore normal speed once lag drops below 0.3s
      this.isDeceleratingVideo = false;
      this.options.onVideoRateAdjust?.(this.normalVideoRate);
    }
  }

  public onSeek(newVideoTime: number): void {
    // Stop currently playing clip
    if (this.currentActiveSource) {
      this.currentActiveSource.stop();
      this.currentActiveSource = null;
      this.currentPlayingClip = null;
    }

    this.prevClipEndVideoTime = newVideoTime;
    this.currentLag = 0;

    // Prune clips that are in the past relative to seek position
    this.queue = this.queue.filter(c => (c.end + this.options.syncOffset) >= newVideoTime - 0.5);

    if (this.unduckTimeoutId) {
      clearTimeout(this.unduckTimeoutId);
      this.unduckTimeoutId = null;
    }

    // Restore video playback rate if decelerating
    if (this.isDeceleratingVideo) {
      this.isDeceleratingVideo = false;
      this.options.onVideoRateAdjust?.(this.normalVideoRate);
    }
  }

  public pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.audioBackend.pause();
    }
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.audioBackend.resume();
    }
  }

  public stop(): void {
    if (this.unduckTimeoutId) {
      clearTimeout(this.unduckTimeoutId);
      this.unduckTimeoutId = null;
    }
    this.audioBackend.stopAll();
    this.currentPlayingClip = null;
    this.currentActiveSource = null;
    this.queue = [];

    if (this.isDeceleratingVideo) {
      this.isDeceleratingVideo = false;
      this.options.onVideoRateAdjust?.(this.normalVideoRate);
    }
  }

  private recordLag(lag: number): void {
    this.recentLags.push(lag);
    if (this.recentLags.length > 20) {
      this.recentLags.shift();
    }
  }

  public getCurrentLag(): number {
    return this.currentLag;
  }

  public getAverageLag(): number {
    if (this.recentLags.length === 0) return 0;
    const sum = this.recentLags.reduce((a, b) => a + b, 0);
    return sum / this.recentLags.length;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public isCurrentlyPlaying(): boolean {
    return this.currentPlayingClip !== null;
  }

  public getIsDucked(): boolean {
    return this.isDucked;
  }

  public getIsDecelerating(): boolean {
    return this.isDeceleratingVideo;
  }
}
