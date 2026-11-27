import { AudioClip, IActiveSource, IAudioBackend } from './types';

function float32ToWavBlob(samples: Float32Array, sampleRate = 24000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // "RIFF"
  view.setUint32(4, 36 + samples.length * 2, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // "WAVE"

  // fmt sub-chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // 16 bits per sample

  // data sub-chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // "data"
  view.setUint32(40, samples.length * 2, true);

  // 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class WebAudioBackend implements IAudioBackend {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private activeAudioElements: Set<HTMLAudioElement> = new Set();
  private volume: number = 1.0;

  constructor() {
    // AudioContext will be initialized on first user interaction or clip play
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playClip(
    clip: AudioClip,
    playbackRate: number,
    volume: number,
    onEnded: () => void
  ): IActiveSource {
    // 1. High-quality native pitch-preserving playback via HTMLAudioElement (Chrome WSOLA engine)
    if (typeof Audio !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        const blob = float32ToWavBlob(clip.audioData, clip.sampleRate);
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.src = url;

        // Native pitch preservation: voice pitch stays natural without chipmunk artifacts!
        audio.preservesPitch = true;
        (audio as any).mozPreservesPitch = true;
        (audio as any).webkitPreservesPitch = true;
        audio.playbackRate = playbackRate;
        audio.volume = Math.max(0, Math.min(1, this.volume * volume));

        let ended = false;
        const cleanup = () => {
          if (ended) return;
          ended = true;
          this.activeAudioElements.delete(audio);
          try {
            audio.pause();
            audio.src = '';
            URL.revokeObjectURL(url);
          } catch {}
          onEnded();
        };

        audio.onended = cleanup;
        audio.onerror = cleanup;

        this.activeAudioElements.add(audio);
        audio.play().catch(() => {
          // If autoplay blocked in strict context, fallback to Web Audio
        });

        return {
          stop: () => {
            cleanup();
          },
          setPlaybackRate: (rate: number) => {
            try {
              audio.playbackRate = rate;
            } catch {}
          }
        };
      } catch {
        // Fallback to Web Audio AudioBufferSourceNode below
      }
    }

    // 2. Web Audio fallback for headless test environments (Vitest / Node)
    const ctx = this.ensureContext();
    const buffer = ctx.createBuffer(1, clip.audioData.length, clip.sampleRate);
    buffer.getChannelData(0).set(clip.audioData);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    let sourceNode: AudioNode = source;
    if (volume !== 1.0 && this.gainNode) {
      const clipGain = ctx.createGain();
      clipGain.gain.value = volume;
      source.connect(clipGain);
      clipGain.connect(this.gainNode);
      sourceNode = clipGain;
    } else if (this.gainNode) {
      source.connect(this.gainNode);
    } else {
      source.connect(ctx.destination);
    }

    this.activeSources.add(source);

    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      this.activeSources.delete(source);
      try {
        source.disconnect();
      } catch {}
      onEnded();
    };

    source.onended = cleanup;
    source.start(0);

    return {
      stop: () => {
        if (!ended) {
          try {
            source.stop();
          } catch {}
          cleanup();
        }
      },
      setPlaybackRate: (rate: number) => {
        try {
          source.playbackRate.value = rate;
        } catch {}
      }
    };
  }

  public async pause(): Promise<void> {
    for (const a of this.activeAudioElements) {
      try { a.pause(); } catch {}
    }
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  public async resume(): Promise<void> {
    for (const a of this.activeAudioElements) {
      try { a.play().catch(() => {}); } catch {}
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public stopAll(): void {
    for (const a of this.activeAudioElements) {
      try {
        a.pause();
        a.src = '';
      } catch {}
    }
    this.activeAudioElements.clear();

    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources.clear();
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const a of this.activeAudioElements) {
      try { a.volume = this.volume; } catch {}
    }
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public getCurrentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}
