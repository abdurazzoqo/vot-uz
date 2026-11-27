import { AudioClip, IActiveSource, IAudioBackend } from './types';

export interface SimulatedPlayingClip {
  clip: AudioClip;
  playbackRate: number;
  volume: number;
  remainingDurationSec: number;
  onEnded: () => void;
  activeSource: IActiveSource;
}

export class SimulatedAudioBackend implements IAudioBackend {
  private currentTimeSec: number = 0;
  private volume: number = 1.0;
  private isPaused: boolean = false;
  private activeClips: SimulatedPlayingClip[] = [];
  public playedHistory: { clip: AudioClip; playbackRate: number; startedAt: number }[] = [];

  public playClip(
    clip: AudioClip,
    playbackRate: number,
    volume: number,
    onEnded: () => void
  ): IActiveSource {
    const effectiveDuration = clip.durationSec / playbackRate;

    let stopped = false;
    const activeSource: IActiveSource = {
      stop: () => {
        if (!stopped) {
          stopped = true;
          this.activeClips = this.activeClips.filter(c => c.activeSource !== activeSource);
          onEnded();
        }
      },
      setPlaybackRate: (rate: number) => {
        const item = this.activeClips.find(c => c.activeSource !== activeSource);
        if (item) {
          item.playbackRate = rate;
        }
      }
    };

    const simClip: SimulatedPlayingClip = {
      clip,
      playbackRate,
      volume,
      remainingDurationSec: effectiveDuration,
      onEnded,
      activeSource
    };

    this.activeClips.push(simClip);
    this.playedHistory.push({ clip, playbackRate, startedAt: this.currentTimeSec });

    return activeSource;
  }

  public advanceTime(seconds: number): void {
    if (this.isPaused || seconds <= 0) return;

    this.currentTimeSec += seconds;

    const finished: SimulatedPlayingClip[] = [];
    for (const sim of [...this.activeClips]) {
      sim.remainingDurationSec -= seconds;
      if (sim.remainingDurationSec <= 0.001) {
        finished.push(sim);
      }
    }

    for (const f of finished) {
      this.activeClips = this.activeClips.filter(c => c !== f);
      f.onEnded();
    }
  }

  public async pause(): Promise<void> {
    this.isPaused = true;
  }

  public async resume(): Promise<void> {
    this.isPaused = false;
  }

  public stopAll(): void {
    const clips = [...this.activeClips];
    this.activeClips = [];
    for (const c of clips) {
      c.onEnded();
    }
  }

  public setVolume(volume: number): void {
    this.volume = volume;
  }

  public getCurrentTime(): number {
    return this.currentTimeSec;
  }

  public getActiveCount(): number {
    return this.activeClips.length;
  }
}
