import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioSyncController } from '../src/core/sync/sync-controller';
import { SimulatedAudioBackend } from '../src/core/sync/simulated-audio-backend';
import { AudioClip } from '../src/core/sync/types';

function createMockClip(id: string, start: number, end: number, durationSec: number): AudioClip {
  const sampleRate = 24000;
  return {
    id,
    start,
    end,
    text: `Text for ${id}`,
    audioData: new Float32Array(Math.floor(durationSec * sampleRate)),
    sampleRate,
    durationSec
  };
}

describe('AudioSyncController', () => {
  let backend: SimulatedAudioBackend;

  beforeEach(() => {
    backend = new SimulatedAudioBackend();
  });

  it('plays clips at their scheduled time and triggers ducking', () => {
    let duckedState = false;
    let startedClipId: string | null = null;

    const controller = new AudioSyncController({
      audioBackend: backend,
      duckLevel: 0.15,
      onDuckChange: (duck) => {
        duckedState = duck;
      },
      onSentenceStart: (clip) => {
        startedClipId = clip.id;
      }
    });

    const clip1 = createMockClip('clip1', 2.0, 4.0, 2.0);
    controller.addClip(clip1);

    // At videoTime 1.0s, clip should not play yet
    controller.tick(1.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(false);
    expect(duckedState).toBe(false);

    // At videoTime 2.0s, clip should play and ducking should activate
    controller.tick(2.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);
    expect(duckedState).toBe(true);
    expect(startedClipId).toBe('clip1');
  });

  it('preserves natural voice pitch by default (speedFactor = 1.0 for normal clip)', () => {
    let observedSpeedFactor = 1.0;

    const controller = new AudioSyncController({
      audioBackend: backend,
      preservePitch: true,
      onSentenceStart: (_clip, _lag, speedFactor) => {
        observedSpeedFactor = speedFactor;
      }
    });

    const normalClip = createMockClip('normalClip', 0.0, 2.0, 1.8);
    controller.addClip(normalClip);

    controller.tick(0.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);
    // Preserves exact natural 1.0x pitch
    expect(observedSpeedFactor).toBe(1.0);
  });

  it('applies Layer 2 clip speedup up to 1.40x when clip duration exceeds window and preservePitch is false', () => {
    let observedSpeedFactor = 1.0;

    const controller = new AudioSyncController({
      audioBackend: backend,
      preservePitch: false,
      onSentenceStart: (_clip, _lag, speedFactor) => {
        observedSpeedFactor = speedFactor;
      }
    });

    // 3.0s audio for a 2.0s window [0.0 - 2.0]
    const longClip = createMockClip('longClip', 0.0, 2.0, 3.0);
    controller.addClip(longClip);

    controller.tick(0.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);
    // Needs speedup, capped at 1.40x
    expect(observedSpeedFactor).toBeGreaterThanOrEqual(1.3);
    expect(observedSpeedFactor).toBeLessThanOrEqual(1.40);
  });

  it('applies Layer 3 pause-to-start alignment for back-to-back clips', () => {
    const startedClips: string[] = [];

    const controller = new AudioSyncController({
      audioBackend: backend,
      onSentenceStart: (clip) => {
        startedClips.push(clip.id);
      }
    });

    // Clip 1: [0.0 - 2.0] with 2s audio
    // Clip 2: [1.5 - 3.5] (starts before clip 1 ends!)
    const clip1 = createMockClip('c1', 0.0, 2.0, 2.0);
    const clip2 = createMockClip('c2', 1.5, 3.5, 2.0);
    controller.addClips([clip1, clip2]);

    controller.tick(0.0, 1.0, false);
    expect(startedClips).toEqual(['c1']);

    // At 1.8s, clip 1 is still playing in simulation, so clip 2 must wait
    controller.tick(1.8, 1.0, false);
    expect(startedClips).toEqual(['c1']);

    // Advance backend clock by 2.0s so clip 1 finishes
    backend.advanceTime(2.0);

    // Now tick at 2.1s, clip 2 should start
    controller.tick(2.1, 1.0, false);
    expect(startedClips).toEqual(['c1', 'c2']);
  });

  it('triggers Layer 4 video deceleration when lag exceeds 1.5s', () => {
    let adjustedVideoRate: number | null = null;

    const controller = new AudioSyncController({
      audioBackend: backend,
      slowVideoSync: true,
      normalVideoRate: 1.0,
      onVideoRateAdjust: (rate) => {
        adjustedVideoRate = rate;
      }
    });

    // Clip scheduled at 1.0s, but video is already at 3.0s (lag = 2.0s > 1.5s)
    const clip = createMockClip('c_late', 1.0, 3.0, 2.0);
    controller.addClip(clip);

    controller.tick(3.0, 1.0, false);

    expect(controller.getIsDecelerating()).toBe(true);
    expect(adjustedVideoRate).toBeCloseTo(0.94, 2);
  });

  it('drops clips under Layer 5 when lag exceeds 5.0s', () => {
    let droppedId: string | null = null;

    const controller = new AudioSyncController({
      audioBackend: backend,
      onClipDropped: (id) => {
        droppedId = id;
      }
    });

    // Clip scheduled at 0.0s, video ticks at 6.0s (lag = 6.0s > 5.0s)
    const hopelessClip = createMockClip('hopeless', 0.0, 2.0, 2.0);
    controller.addClip(hopelessClip);

    controller.tick(6.0, 1.0, false);

    expect(droppedId).toBe('hopeless');
    expect(controller.isCurrentlyPlaying()).toBe(false);
    expect(controller.getQueueLength()).toBe(0);
  });

  it('respects Layer 6 manual sync offset', () => {
    const controller = new AudioSyncController({
      audioBackend: backend,
      syncOffset: 1.5 // delay dubbing by +1.5s
    });

    const clip = createMockClip('c_offset', 2.0, 4.0, 2.0);
    controller.addClip(clip);

    // At videoTime 2.5s (before 2.0 + 1.5 = 3.5s), should not play
    controller.tick(2.5, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(false);

    // At videoTime 3.5s, should start playing
    controller.tick(3.5, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);
  });

  it('handles seek: stops active audio and removes stale past clips', () => {
    const controller = new AudioSyncController({
      audioBackend: backend
    });

    const clip1 = createMockClip('c1', 1.0, 3.0, 2.0);
    const clip2 = createMockClip('c2', 10.0, 12.0, 2.0);
    controller.addClips([clip1, clip2]);

    controller.tick(1.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);

    // Seek to 10.0s
    controller.onSeek(10.0);
    expect(controller.isCurrentlyPlaying()).toBe(false);

    // Old clip1 should have been purged, clip2 retained
    expect(controller.getQueueLength()).toBe(1);

    // Tick at 10.0s should play clip2
    controller.tick(10.0, 1.0, false);
    expect(controller.isCurrentlyPlaying()).toBe(true);
  });
});
