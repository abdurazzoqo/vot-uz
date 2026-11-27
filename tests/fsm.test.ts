import { describe, it, expect, beforeEach } from 'vitest';
import { SessionMachine } from '@/core/fsm/session-machine';

describe('SessionMachine FSM', () => {
  let fsm: SessionMachine;

  beforeEach(() => {
    fsm = new SessionMachine({
      holdVideoSetting: true,
      gateThresholdSeconds: 10
    });
  });

  it('starts in idle state', () => {
    expect(fsm.getState()).toBe('idle');
    expect(fsm.getContext().pausedByExtension).toBe(false);
  });

  it('transitions from idle to gated on VIDEO_CHANGED when holdVideo is true', () => {
    const res = fsm.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'test_vid_1',
      currentTime: 0,
      duration: 300
    });

    expect(res.state).toBe('gated');
    expect(res.context.pausedByExtension).toBe(true);
    expect(res.context.videoId).toBe('test_vid_1');

    const effectTypes = res.effects.map(e => e.type);
    expect(effectTypes).toContain('PAUSE_VIDEO');
    expect(effectTypes).toContain('MUTE_VIDEO');
    expect(effectTypes).toContain('SHOW_WAITING_OVERLAY');
    expect(effectTypes).toContain('START_TRANSLATION_WINDOW');
  });

  it('prevents user playback while in gated state and highlights cancel', () => {
    fsm.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'test_vid_1',
      currentTime: 0,
      duration: 300
    });
    expect(fsm.getState()).toBe('gated');

    // User tries to hit play/spacebar
    const playRes = fsm.dispatch({ type: 'PLAY', isUserInitiated: true });
    expect(playRes.state).toBe('gated'); // Remains gated
    expect(playRes.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(playRes.effects.map(e => e.type)).toContain('HIGHLIGHT_CANCEL_BUTTON');
  });

  it('opens gate and resumes video when buffer reaches threshold (>= 10s)', () => {
    fsm.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'test_vid_1',
      currentTime: 0,
      duration: 300
    });

    // 5 seconds ready -> still gated
    let bufRes = fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 5 });
    expect(bufRes.state).toBe('gated');

    // 10 seconds ready -> transitions to playing!
    bufRes = fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 10.5 });
    expect(bufRes.state).toBe('playing');
    expect(bufRes.context.pausedByExtension).toBe(false);

    const effectTypes = bufRes.effects.map(e => e.type);
    expect(effectTypes).toContain('HIDE_WAITING_OVERLAY');
    expect(effectTypes).toContain('UNMUTE_VIDEO');
    expect(effectTypes).toContain('RESUME_VIDEO');
    expect(effectTypes).toContain('SET_DUCKING');
  });

  it('does NOT auto-resume if user manually paused while gated', () => {
    fsm.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'test_vid_1',
      currentTime: 0,
      duration: 300
    });

    // User explicitly pressed pause
    fsm.dispatch({ type: 'PAUSE', isUserInitiated: true });
    expect(fsm.getContext().pausedByExtension).toBe(false);

    // Buffer ready
    const bufRes = fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 12 });
    expect(bufRes.state).toBe('playing');
    expect(bufRes.effects.map(e => e.type)).not.toContain('RESUME_VIDEO');
  });

  it('handles small seeks within buffered range seamlessly without pause or overlay', () => {
    // Bring to playing
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 15 });
    expect(fsm.getState()).toBe('playing');

    // Small seek within buffered range
    const seekRes = fsm.dispatch({
      type: 'SEEKED',
      currentTime: 5,
      isWithinBufferedRange: true
    });

    expect(seekRes.state).toBe('playing');
    expect(seekRes.effects.length).toBe(0); // Seamless, no effects needed
  });

  it('handles seeks outside buffered range by gating and pausing', () => {
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 15 });
    expect(fsm.getState()).toBe('playing');

    // Large seek outside buffer
    const seekRes = fsm.dispatch({
      type: 'SEEKED',
      currentTime: 120,
      isWithinBufferedRange: false
    });

    expect(seekRes.state).toBe('seeking_gated');
    expect(seekRes.context.pausedByExtension).toBe(true);
    expect(seekRes.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(seekRes.effects.map(e => e.type)).toContain('SHOW_WAITING_OVERLAY');
    expect(seekRes.effects.map(e => e.type)).toContain('FLUSH_TTS_QUEUE');
    expect(seekRes.effects.map(e => e.type)).toContain('START_TRANSLATION_WINDOW');

    // When translation + TTS finishes for seeked position (ready >= 2.0s):
    const readyRes = fsm.dispatch({
      type: 'BUFFER_UPDATE',
      readySecondsAhead: 2.5
    });

    expect(readyRes.state).toBe('playing');
    expect(readyRes.context.pausedByExtension).toBe(false);
    expect(readyRes.effects.map(e => e.type)).toContain('RESUME_VIDEO');
    expect(readyRes.effects.map(e => e.type)).toContain('HIDE_WAITING_OVERLAY');
  });

  it('handles cancel properly: aborts requests, clears overlay, restores volume', () => {
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    expect(fsm.getState()).toBe('gated');

    const cancelRes = fsm.dispatch({ type: 'CANCEL' });
    expect(cancelRes.state).toBe('cancelled');
    expect(cancelRes.context.pausedByExtension).toBe(false);

    const effectTypes = cancelRes.effects.map(e => e.type);
    expect(effectTypes).toContain('CANCEL_IN_FLIGHT_REQUESTS');
    expect(effectTypes).toContain('FLUSH_TTS_QUEUE');
    expect(effectTypes).toContain('HIDE_WAITING_OVERLAY');
    expect(effectTypes).toContain('UNMUTE_VIDEO');
    expect(effectTypes).toContain('RESUME_VIDEO');
    expect(effectTypes).toContain('SET_DUCKING');

    // Cancelling again is idempotent
    const cancelAgain = fsm.dispatch({ type: 'CANCEL' });
    expect(cancelAgain.state).toBe('cancelled');
  });

  it('pauses dubbing and hides overlay during ads, then restores state after ad ends', () => {
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 15 });
    expect(fsm.getState()).toBe('playing');

    // Ad starts
    const adStartRes = fsm.dispatch({ type: 'AD_START' });
    expect(adStartRes.state).toBe('ad');
    expect(adStartRes.effects.map(e => e.type)).toContain('SET_DUCKING'); // ducked: false

    // Ad finishes
    const adEndRes = fsm.dispatch({ type: 'AD_END' });
    expect(adEndRes.state).toBe('playing');
    expect(adEndRes.effects.map(e => e.type)).toContain('SET_DUCKING'); // ducked: true
  });

  it('handles buffer starvation during playback by holding video and showing overlay', () => {
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 15 });
    expect(fsm.getState()).toBe('playing');

    // Starvation happens
    const starvedRes = fsm.dispatch({ type: 'BUFFER_STARVED' });
    expect(starvedRes.state).toBe('gated');
    expect(starvedRes.context.pausedByExtension).toBe(true);
    expect(starvedRes.effects.map(e => e.type)).toContain('PAUSE_VIDEO');
    expect(starvedRes.effects.map(e => e.type)).toContain('MUTE_VIDEO');
    expect(starvedRes.effects.map(e => e.type)).toContain('SHOW_WAITING_OVERLAY');

    // Speech catches up and gate opens
    const resumeRes = fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 11 });
    expect(resumeRes.state).toBe('playing');
    expect(resumeRes.effects.map(e => e.type)).toContain('RESUME_VIDEO');
    expect(resumeRes.effects.map(e => e.type)).toContain('UNMUTE_VIDEO');
    expect(resumeRes.effects.map(e => e.type)).toContain('HIDE_WAITING_OVERLAY');
  });

  it('logs every transition with timestamp and context', () => {
    fsm.dispatch({ type: 'VIDEO_CHANGED', videoId: 'test_vid_1', currentTime: 0, duration: 300 });
    fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 15 });
    fsm.dispatch({ type: 'CANCEL' });

    const logs = fsm.getLogs();
    expect(logs.length).toBe(3);
    expect(logs[0].fromState).toBe('idle');
    expect(logs[0].toState).toBe('gated');
    expect(logs[1].fromState).toBe('gated');
    expect(logs[1].toState).toBe('playing');
    expect(logs[2].fromState).toBe('playing');
    expect(logs[2].toState).toBe('cancelled');
  });

  it('opens gate with lower dynamic threshold near the end of video', () => {
    fsm.dispatch({
      type: 'VIDEO_CHANGED',
      videoId: 'test_vid_end',
      currentTime: 295, // 5s remaining in a 300s video
      duration: 300
    });
    expect(fsm.getState()).toBe('gated');

    // 4.0s of ready audio is plenty for a 5s remaining clip!
    const bufRes = fsm.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: 4.0 });
    expect(bufRes.state).toBe('playing');
    expect(bufRes.effects.map(e => e.type)).toContain('HIDE_WAITING_OVERLAY');
  });
});
