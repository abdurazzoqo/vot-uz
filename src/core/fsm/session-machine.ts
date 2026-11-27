import {
  SessionState,
  SessionEvent,
  MachineEffect,
  SessionContext,
  TransitionResult,
  TransitionLogEntry
} from './types';

/**
 * State Transition Table Documentation:
 * 
 * +---------------+------------------+------------------+-------------------------------------------------------+
 * | From State    | Event            | To State         | Effects                                               |
 * +---------------+------------------+------------------+-------------------------------------------------------+
 * | idle          | VIDEO_CHANGED    | preparing        | START_TRANSLATION_WINDOW, [PAUSE_VIDEO, MUTE, OVERLAY]|
 * | idle          | ENABLE           | preparing        | START_TRANSLATION_WINDOW, [PAUSE_VIDEO, MUTE, OVERLAY]|
 * | preparing     | BUFFER_UPDATE    | playing / gated  | if ready: HIDE_OVERLAY, UNMUTE, RESUME, DUCK          |
 * | preparing     | PLAY (user)      | preparing/gated  | if pausedByExtension: PAUSE_VIDEO, HIGHLIGHT_CANCEL   |
 * | preparing     | AD_START         | ad               | HIDE_OVERLAY, UNMUTE, DUCK(false)                     |
 * | preparing     | CANCEL           | cancelled        | CANCEL_REQ, FLUSH_TTS, HIDE_OVERLAY, UNMUTE, DUCK(f)  |
 * | preparing     | ERROR            | error            | SHOW_ERROR_OVERLAY, UNMUTE, DUCK(false)               |
 * | gated         | BUFFER_UPDATE    | playing          | HIDE_OVERLAY, UNMUTE, RESUME, DUCK(true)              |
 * | gated         | PLAY (user)      | gated            | PAUSE_VIDEO, HIGHLIGHT_CANCEL                         |
 * | gated         | CANCEL           | cancelled        | CANCEL_REQ, FLUSH_TTS, HIDE_OVERLAY, RESUME, DUCK(f)  |
 * | gated         | AD_START         | ad               | HIDE_OVERLAY, UNMUTE, DUCK(false)                     |
 * | playing       | SEEKED(in range) | playing          | (none: seamless continuation)                         |
 * | playing       | SEEKED(out range)| seeking_gated    | PAUSE, MUTE, SHOW_OVERLAY, FLUSH_TTS, START_WINDOW   |
 * | playing       | AD_START         | ad               | DUCK(false)                                           |
 * | playing       | CANCEL           | cancelled        | CANCEL_REQ, FLUSH_TTS, DUCK(false)                    |
 * | playing       | PAUSE (user)     | playing          | pausedByExtension = false                             |
 * | seeking_gated | BUFFER_UPDATE    | playing          | HIDE_OVERLAY, UNMUTE, RESUME, DUCK(true)              |
 * | seeking_gated | PLAY (user)      | seeking_gated    | PAUSE_VIDEO, HIGHLIGHT_CANCEL                         |
 * | seeking_gated | CANCEL           | cancelled        | CANCEL_REQ, FLUSH_TTS, HIDE_OVERLAY, RESUME, DUCK(f)  |
 * | ad            | AD_END           | playing/preparing| restore state, DUCK(true) if dubbing ready            |
 * | cancelled     | ENABLE           | preparing        | START_WINDOW, PAUSE, MUTE, SHOW_OVERLAY               |
 * | cancelled     | VIDEO_CHANGED    | preparing        | START_WINDOW, PAUSE, MUTE, SHOW_OVERLAY               |
 * | error         | CANCEL           | cancelled        | HIDE_OVERLAY, RESUME if pausedByExtension             |
 * | error         | ENABLE           | preparing        | START_WINDOW, PAUSE, MUTE, SHOW_OVERLAY               |
 * +---------------+------------------+------------------+-------------------------------------------------------+
 */

export class SessionMachine {
  private state: SessionState = 'idle';
  private context: SessionContext;
  private transitionLogs: TransitionLogEntry[] = [];
  private onTransitionListener?: (result: TransitionResult, log: TransitionLogEntry) => void;

  constructor(
    initialContext?: Partial<SessionContext>,
    onTransition?: (result: TransitionResult, log: TransitionLogEntry) => void
  ) {
    this.context = {
      sessionId: initialContext?.sessionId || this.generateSessionId(),
      videoId: initialContext?.videoId || '',
      currentTime: initialContext?.currentTime || 0,
      duration: initialContext?.duration || 0,
      pausedByExtension: initialContext?.pausedByExtension || false,
      holdVideoSetting: initialContext?.holdVideoSetting ?? true,
      gateThresholdSeconds: initialContext?.gateThresholdSeconds ?? 2.0,
      readySecondsAhead: initialContext?.readySecondsAhead ?? 0,
      isAdPlaying: false,
      ...initialContext
    };
    this.onTransitionListener = onTransition;
  }

  public getState(): SessionState {
    return this.state;
  }

  public getContext(): Readonly<SessionContext> {
    return { ...this.context };
  }

  public updateDuration(duration: number): void {
    if (typeof duration === 'number' && !isNaN(duration) && duration > 0) {
      this.context.duration = duration;
    }
  }

  public getLogs(): readonly TransitionLogEntry[] {
    return [...this.transitionLogs];
  }

  public dispatch(event: SessionEvent): TransitionResult {
    const fromState = this.state;
    const { nextState, nextContext, effects } = this.computeTransition(this.state, event, this.context);

    this.state = nextState;
    this.context = nextContext;

    const logEntry: TransitionLogEntry = {
      timestamp: Date.now(),
      sessionId: this.context.sessionId,
      videoId: this.context.videoId,
      fromState,
      event: event.type,
      toState: nextState,
      pausedByExtension: this.context.pausedByExtension,
      effects: effects.map(e => e.type)
    };

    this.transitionLogs.push(logEntry);
    if (this.transitionLogs.length > 200) {
      this.transitionLogs.shift();
    }

    const result: TransitionResult = {
      state: nextState,
      context: { ...nextContext },
      effects
    };

    if (this.onTransitionListener) {
      this.onTransitionListener(result, logEntry);
    }

    return result;
  }

  private computeTransition(
    currentState: SessionState,
    event: SessionEvent,
    ctx: SessionContext
  ): { nextState: SessionState; nextContext: SessionContext; effects: MachineEffect[] } {
    const effects: MachineEffect[] = [];
    let nextState = currentState;
    let nextCtx = { ...ctx };

    switch (event.type) {
      case 'VIDEO_CHANGED': {
        const newSessionId = this.generateSessionId();
        nextCtx = {
          ...nextCtx,
          sessionId: newSessionId,
          videoId: event.videoId,
          currentTime: event.currentTime,
          duration: event.duration,
          readySecondsAhead: 0,
          errorMessage: undefined,
          isAdPlaying: false,
          previousNonAdState: undefined
        };

        effects.push({ type: 'CANCEL_IN_FLIGHT_REQUESTS' });
        effects.push({ type: 'FLUSH_TTS_QUEUE' });
        effects.push({ type: 'START_TRANSLATION_WINDOW', position: event.currentTime });

        if (nextCtx.holdVideoSetting) {
          nextState = 'gated';
          nextCtx.pausedByExtension = true;
          effects.push({ type: 'PAUSE_VIDEO' });
          effects.push({ type: 'MUTE_VIDEO' });
          effects.push({ type: 'SHOW_WAITING_OVERLAY' });
        } else {
          nextState = 'preparing';
          nextCtx.pausedByExtension = false;
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'CANCEL': {
        if (currentState === 'cancelled') {
          return { nextState: 'cancelled', nextContext: nextCtx, effects };
        }
        nextState = 'cancelled';
        effects.push({ type: 'CANCEL_IN_FLIGHT_REQUESTS' });
        effects.push({ type: 'FLUSH_TTS_QUEUE' });
        effects.push({ type: 'HIDE_WAITING_OVERLAY' });
        effects.push({ type: 'SET_DUCKING', ducked: false });
        effects.push({ type: 'UNMUTE_VIDEO' });

        if (nextCtx.pausedByExtension) {
          effects.push({ type: 'RESUME_VIDEO' });
          nextCtx.pausedByExtension = false;
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'ENABLE': {
        if (currentState === 'playing' || currentState === 'gated' || currentState === 'preparing') {
          return { nextState: currentState, nextContext: nextCtx, effects };
        }
        effects.push({ type: 'START_TRANSLATION_WINDOW', position: nextCtx.currentTime });
        if (nextCtx.readySecondsAhead >= nextCtx.gateThresholdSeconds) {
          nextState = 'playing';
          effects.push({ type: 'SET_DUCKING', ducked: true });
        } else if (nextCtx.holdVideoSetting) {
          nextState = 'gated';
          nextCtx.pausedByExtension = true;
          effects.push({ type: 'PAUSE_VIDEO' });
          effects.push({ type: 'MUTE_VIDEO' });
          effects.push({ type: 'SHOW_WAITING_OVERLAY' });
        } else {
          nextState = 'preparing';
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'ERROR': {
        nextState = 'error';
        nextCtx.errorMessage = event.message;
        effects.push({ type: 'SHOW_ERROR_OVERLAY', message: event.message });
        effects.push({ type: 'SET_DUCKING', ducked: false });
        effects.push({ type: 'UNMUTE_VIDEO' });
        if (nextCtx.pausedByExtension) {
          effects.push({ type: 'RESUME_VIDEO' });
          nextCtx.pausedByExtension = false;
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'AD_START': {
        if (currentState !== 'ad') {
          nextCtx.previousNonAdState = currentState;
          nextCtx.isAdPlaying = true;
          nextState = 'ad';
          effects.push({ type: 'HIDE_WAITING_OVERLAY' });
          effects.push({ type: 'SET_DUCKING', ducked: false });
          effects.push({ type: 'UNMUTE_VIDEO' });
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'AD_END': {
        if (currentState === 'ad') {
          nextCtx.isAdPlaying = false;
          const returnState = nextCtx.previousNonAdState || 'preparing';
          nextCtx.previousNonAdState = undefined;

          if (returnState === 'gated' || returnState === 'seeking_gated') {
            nextState = returnState;
            if (nextCtx.holdVideoSetting) {
              effects.push({ type: 'PAUSE_VIDEO' });
              effects.push({ type: 'MUTE_VIDEO' });
              effects.push({ type: 'SHOW_WAITING_OVERLAY' });
              nextCtx.pausedByExtension = true;
            }
          } else if (returnState === 'playing') {
            nextState = 'playing';
            effects.push({ type: 'SET_DUCKING', ducked: true });
          } else {
            nextState = returnState;
          }
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'PLAY': {
        if (currentState === 'gated' || currentState === 'seeking_gated') {
          // User attempted to play while gated: must re-pause immediately and highlight cancel
          effects.push({ type: 'PAUSE_VIDEO' });
          effects.push({ type: 'HIGHLIGHT_CANCEL_BUTTON' });
          return { nextState: currentState, nextContext: nextCtx, effects };
        }
        if (event.isUserInitiated) {
          nextCtx.pausedByExtension = false;
        }
        return { nextState: currentState, nextContext: nextCtx, effects };
      }

      case 'PAUSE': {
        if (event.isUserInitiated) {
          nextCtx.pausedByExtension = false;
        }
        return { nextState: currentState, nextContext: nextCtx, effects };
      }

      case 'SEEKING': {
        // Prepare for seek
        return { nextState: currentState, nextContext: nextCtx, effects };
      }

      case 'SEEKED': {
        nextCtx.currentTime = event.currentTime;
        if (currentState === 'cancelled' || currentState === 'ad') {
          return { nextState: currentState, nextContext: nextCtx, effects };
        }

        if (event.isWithinBufferedRange) {
          // Small seek inside processed range (~+-10s): continue seamlessly
          return { nextState: 'playing', nextContext: nextCtx, effects };
        }

        // Seeked to an unprocessed range:
        effects.push({ type: 'CANCEL_IN_FLIGHT_REQUESTS' });
        effects.push({ type: 'FLUSH_TTS_QUEUE' });
        effects.push({ type: 'START_TRANSLATION_WINDOW', position: event.currentTime });
        nextCtx.readySecondsAhead = 0;

        if (nextCtx.holdVideoSetting) {
          nextState = 'seeking_gated';
          nextCtx.pausedByExtension = true;
          effects.push({ type: 'PAUSE_VIDEO' });
          effects.push({ type: 'MUTE_VIDEO' });
          effects.push({ type: 'SHOW_WAITING_OVERLAY' });
        } else {
          nextState = 'preparing';
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'BUFFER_STARVED': {
        if (currentState === 'playing') {
          if (nextCtx.holdVideoSetting) {
            nextState = 'gated';
            nextCtx.pausedByExtension = true;
            nextCtx.readySecondsAhead = 0;
            effects.push({ type: 'PAUSE_VIDEO' });
            effects.push({ type: 'MUTE_VIDEO' });
            effects.push({ type: 'SHOW_WAITING_OVERLAY' });
          }
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      case 'BUFFER_UPDATE': {
        nextCtx.readySecondsAhead = event.readySecondsAhead;

        if (currentState === 'gated' || currentState === 'seeking_gated' || currentState === 'preparing') {
          // Dynamic threshold: if remaining video duration is shorter than gateThresholdSeconds (e.g. near video end)
          const remainingVideoSec = (nextCtx.duration && nextCtx.duration > 0)
            ? Math.max(0, nextCtx.duration - nextCtx.currentTime)
            : 10;
          // For seeking_gated: resume as soon as the first sentence audio is ready (>= 2.0s)
          // For initial gated: wait for full gateThresholdSeconds (10s)
          const baseThreshold = currentState === 'seeking_gated' ? 2.0 : nextCtx.gateThresholdSeconds;
          const dynamicThreshold = remainingVideoSec < baseThreshold
            ? Math.min(baseThreshold, Math.max(1.0, remainingVideoSec * 0.6))
            : baseThreshold;

          if (nextCtx.readySecondsAhead >= dynamicThreshold) {
            nextState = 'playing';
            effects.push({ type: 'HIDE_WAITING_OVERLAY' });
            effects.push({ type: 'UNMUTE_VIDEO' });
            effects.push({ type: 'SET_DUCKING', ducked: true });

            if (nextCtx.pausedByExtension) {
              effects.push({ type: 'RESUME_VIDEO' });
              nextCtx.pausedByExtension = false;
            }
          }
        }
        return { nextState, nextContext: nextCtx, effects };
      }

      default:
        return { nextState: currentState, nextContext: nextCtx, effects };
    }
  }

  private generateSessionId(): string {
    return 'sess_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
  }
}
