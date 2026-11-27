/**
 * Finite State Machine for VOT Uzbek Video Sessions.
 * 
 * Rules:
 * - Exactly ONE session per video with a unique sessionId.
 * - Idempotent transitions.
 * - Stale session events are dropped.
 * - pausedByExtension is managed strictly within this state machine.
 */

export type SessionState =
  | 'idle'
  | 'preparing'
  | 'gated'
  | 'playing'
  | 'seeking_gated'
  | 'ad'
  | 'cancelled'
  | 'error';

export type SessionEvent =
  | { type: 'VIDEO_CHANGED'; videoId: string; currentTime: number; duration: number }
  | { type: 'PLAY'; isUserInitiated?: boolean }
  | { type: 'PAUSE'; isUserInitiated?: boolean }
  | { type: 'SEEKING'; targetTime: number }
  | { type: 'SEEKED'; currentTime: number; isWithinBufferedRange: boolean }
  | { type: 'AD_START' }
  | { type: 'AD_END' }
  | { type: 'BUFFER_UPDATE'; readySecondsAhead: number }
  | { type: 'BUFFER_STARVED' }
  | { type: 'CANCEL' }
  | { type: 'ENABLE' }
  | { type: 'ERROR'; message: string; code?: string };

export type MachineEffect =
  | { type: 'PAUSE_VIDEO' }
  | { type: 'RESUME_VIDEO' }
  | { type: 'MUTE_VIDEO' }
  | { type: 'UNMUTE_VIDEO' }
  | { type: 'SHOW_WAITING_OVERLAY'; text?: string }
  | { type: 'HIDE_WAITING_OVERLAY' }
  | { type: 'SHOW_ERROR_OVERLAY'; message: string }
  | { type: 'START_TRANSLATION_WINDOW'; position: number }
  | { type: 'CANCEL_IN_FLIGHT_REQUESTS' }
  | { type: 'FLUSH_TTS_QUEUE' }
  | { type: 'SET_DUCKING'; ducked: boolean }
  | { type: 'HIGHLIGHT_CANCEL_BUTTON' };

export interface SessionContext {
  sessionId: string;
  videoId: string;
  currentTime: number;
  duration: number;
  pausedByExtension: boolean;
  holdVideoSetting: boolean;
  gateThresholdSeconds: number; // default ~10s
  readySecondsAhead: number;
  errorMessage?: string;
  isAdPlaying: boolean;
  previousNonAdState?: SessionState;
}

export interface TransitionResult {
  state: SessionState;
  context: SessionContext;
  effects: MachineEffect[];
}

export interface TransitionLogEntry {
  timestamp: number;
  sessionId: string;
  videoId: string;
  fromState: SessionState;
  event: string;
  toState: SessionState;
  pausedByExtension: boolean;
  effects: string[];
}
