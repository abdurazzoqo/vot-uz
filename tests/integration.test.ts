import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionMachine } from '@/core/fsm/session-machine';
import { WindowPlanner } from '@/core/scheduler/window-planner';
import { PriorityScheduler } from '@/core/scheduler/priority-scheduler';
import { RollingBuffer } from '@/core/tts/rolling-buffer';
import { AudioSyncController } from '@/core/sync/sync-controller';
import { SimulatedAudioBackend } from '@/core/sync/simulated-audio-backend';
import { TextSource, TextSourceResult, WindowRequestOptions } from '@/core/text-source/types';

class MockSource implements TextSource {
  public async fetchWindow(options: WindowRequestOptions): Promise<TextSourceResult> {
    const start = options.startSec;
    const end = options.endSec;
    return {
      sentences: [
        { start: start + 1.0, end: start + 5.0, uz: `Uzbek speech [${start + 1}-${start + 5}]`, src_lang: 'en' },
        { start: start + 6.0, end: start + 11.0, uz: `Uzbek speech [${start + 6}-${start + 11}]`, src_lang: 'en' }
      ],
      sourceUsed: 'SOURCE_A',
      latencyMs: 150
    };
  }
}

describe('Full End-to-End Workflow Integration Test', () => {
  it('simulates complete lifecycle: gate -> synthesis -> playback -> seek -> starvation -> ad -> cancel', async () => {
    const planner = new WindowPlanner([25, 45, 90, 180, 300]);
    const rollingBuffer = new RollingBuffer({ horizonAheadSec: 60, keepBehindSec: 120 });
    const audioBackend = new SimulatedAudioBackend();

    let duckState = false;
    const syncController = new AudioSyncController({
      audioBackend,
      duckLevel: 0.15,
      dubbingVolume: 1.0,
      preservePitch: true,
      onDuckChange: (duck) => {
        duckState = duck;
      }
    });

    const mockSource = new MockSource();
    let completedWindows = 0;
    const scheduler = new PriorityScheduler({
      textSource: mockSource,
      maxConcurrency: 2,
      prefetchLimitSeconds: 600,
      callbacks: {
        onWindowSuccess: (_win, sentences) => {
          completedWindows++;
          rollingBuffer.addSentences(sentences);
        },
        onWindowError: () => {}
      }
    });

    // 1. Video detected (initial state -> gated)
    const machine = new SessionMachine({
      videoId: 'vid_yt_full_test',
      currentTime: 0,
      duration: 600,
      holdVideoSetting: true,
      gateThresholdSeconds: 10
    });

    const initRes = machine.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'vid_yt_full_test',
      currentTime: 0,
      duration: 600
    });
    expect(initRes.state).toBe('gated');
    expect(initRes.context.pausedByExtension).toBe(true);

    scheduler.initSession('vid_yt_full_test', 'fake_key', 0);
    const windows = planner.planWindows(0, 600);
    scheduler.enqueueWindows(windows);

    // 2. User tries to play during gate -> intercepted!
    const playAttempt = machine.dispatch({ type: 'PLAY', isUserInitiated: true });
    expect(playAttempt.state).toBe('gated');
    expect(playAttempt.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(playAttempt.effects.map(e => e.type)).toContain('HIGHLIGHT_CANCEL_BUTTON');

    // Wait for scheduler to fetch initial window
    await new Promise(r => setTimeout(r, 200));
    expect(completedWindows).toBeGreaterThanOrEqual(1);

    // 3. TTS synthesizes audio in rolling buffer
    const pending = rollingBuffer.updatePlayhead(0);
    expect(pending.length).toBeGreaterThanOrEqual(2);

    // Synthesize sentence 1
    const s1 = pending[0];
    const audio1 = new Float32Array(24000 * 4); // 4s
    rollingBuffer.setAudio(s1.id, audio1, 24000);
    syncController.addClip({
      id: s1.id,
      start: s1.start,
      end: s1.end,
      text: s1.uz,
      audioData: audio1,
      sampleRate: 24000,
      durationSec: 4
    });

    // Check buffer ahead after 1 sentence
    let readySec = rollingBuffer.computeReadyDurationAhead(0);
    expect(readySec).toBe(6); // covered through s1 (5s) + up to s2 start (6s)
    let bufUpdate = machine.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: readySec });
    expect(bufUpdate.state).toBe('gated'); // < 10s -> still gated

    // Synthesize sentence 2
    const s2 = pending[1];
    const audio2 = new Float32Array(24000 * 5); // 5s
    rollingBuffer.setAudio(s2.id, audio2, 24000);
    syncController.addClip({
      id: s2.id,
      start: s2.start,
      end: s2.end,
      text: s2.uz,
      audioData: audio2,
      sampleRate: 24000,
      durationSec: 5
    });

    readySec = rollingBuffer.computeReadyDurationAhead(0);
    expect(readySec).toBeGreaterThanOrEqual(10); // 11s >= 10s

    // 4. Gate opens -> state transitions to playing!
    bufUpdate = machine.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: readySec });
    expect(bufUpdate.state).toBe('playing');
    expect(bufUpdate.context.pausedByExtension).toBe(false);
    expect(bufUpdate.effects.map(e => e.type)).toContain('RESUME_VIDEO');
    expect(bufUpdate.effects.map(e => e.type)).toContain('UNMUTE_VIDEO');
    expect(bufUpdate.effects.map(e => e.type)).toContain('SET_DUCKING');

    // 5. Playback ticks at video time 1.0s -> clip 1 starts!
    syncController.tick(1.0, 1.0, false);
    expect(syncController.isCurrentlyPlaying()).toBe(true);
    expect(duckState).toBe(true);

    // 6. Rewind test: Seek back to 1.0s (within buffered range)
    rollingBuffer.onSeek(1.0);
    syncController.onSeek(1.0);
    const readyClips = rollingBuffer.getReadyClipsFrom(1.0);
    for (const c of readyClips) {
      if (c.audio && c.end > 1.0) {
        syncController.addClip({
          id: c.id,
          start: c.start,
          end: c.end,
          text: c.uz,
          audioData: c.audio,
          sampleRate: c.sampleRate,
          durationSec: c.durationSec
        });
      }
    }
    const hasAudio = rollingBuffer.hasAudioFor(1.0);
    expect(hasAudio).toBe(true);

    const seekInBuf = machine.dispatch({
      type: 'SEEKED',
      currentTime: 1.0,
      isWithinBufferedRange: true
    });
    expect(seekInBuf.state).toBe('playing');
    expect(seekInBuf.effects.length).toBe(0); // Seamless, no pause or overlay!

    // 7. Starvation test: Buffer runs out during playback
    const starvationRes = machine.dispatch({ type: 'BUFFER_STARVED' });
    expect(starvationRes.state).toBe('gated');
    expect(starvationRes.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(starvationRes.effects.map(e => e.type)).toContain('MUTE_VIDEO');

    // Buffer catches up
    const recovered = machine.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 12 });
    expect(recovered.state).toBe('playing');

    // 8. Seek outside buffered range (e.g. to 300s)
    const seekFar = machine.dispatch({
      type: 'SEEKED',
      currentTime: 300,
      isWithinBufferedRange: false
    });
    expect(seekFar.state).toBe('seeking_gated');
    expect(seekFar.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(seekFar.effects.map(e => e.type)).toContain('CANCEL_IN_FLIGHT_REQUESTS');
    expect(seekFar.effects.map(e => e.type)).toContain('FLUSH_TTS_QUEUE');

    // 9. Ad handling
    const adStart = machine.dispatch({ type: 'AD_START' });
    expect(adStart.state).toBe('ad');
    expect(adStart.effects.map(e => e.type)).toContain('SET_DUCKING');

    const adEnd = machine.dispatch({ type: 'AD_END' });
    expect(adEnd.state).toBe('seeking_gated'); // Restored state

    // 10. Cancel handling
    const cancelRes = machine.dispatch({ type: 'CANCEL' });
    expect(cancelRes.state).toBe('cancelled');
    expect(cancelRes.effects.map(e => e.type)).toContain('CANCEL_IN_FLIGHT_REQUESTS');
    expect(cancelRes.effects.map(e => e.type)).toContain('UNMUTE_VIDEO');
  });
});
