import { SessionEvent, MachineEffect, SessionState } from '../fsm/types';
import { ExtensionSettings } from '../storage/settings';

export interface TranslatedSentence {
  start: number;
  end: number;
  uz: string;
  src_lang: string;
}

export type ExtensionMessage =
  | { type: 'SESSION_EVENT'; sessionId: string; event: SessionEvent }
  | { type: 'SESSION_EFFECTS'; sessionId: string; state: SessionState; effects: MachineEffect[] }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'SETTINGS_CHANGED'; settings: ExtensionSettings }
  | { type: 'TTS_WARMUP' }
  | { type: 'TTS_WARMUP_DONE'; speedFactor: number }
  | { type: 'TTS_SYNTHESIZE'; sentenceId: string; text: string; voice: 'f1' | 'm1' }
  | { type: 'TTS_AUDIO_READY'; sentenceId: string; audioData: number[]; sampleRate: number; duration: number }
  | { type: 'TTS_CANCEL' }
  | { type: 'ENSURE_OFFSCREEN' }
  | { type: 'CHECK_API_KEY'; key: string };

// Window postMessage for Isolated <-> Main world communication
export const VOT_PAGE_MSG_PREFIX = '__VOT_UZ_PAGE__';

export interface PageBridgeMessage {
  prefix: typeof VOT_PAGE_MSG_PREFIX;
  type:
    | 'VIDEO_DETECTED'
    | 'PLAYER_PLAY'
    | 'PLAYER_PAUSE'
    | 'PLAYER_SEEKING'
    | 'PLAYER_SEEKED'
    | 'AD_STATE_CHANGE'
    | 'TOGGLE_DUBBING'
    | 'EXECUTE_EFFECT'
    | 'STATE_UPDATE'
    | 'ADJUST_VIDEO_RATE'
    | 'REQUEST_VIDEO_STATUS'
    | 'SET_DUCKING';
  payload?: any;
}

export function isPageBridgeMessage(data: any): data is PageBridgeMessage {
  return data && typeof data === 'object' && data.prefix === VOT_PAGE_MSG_PREFIX;
}

export function createPageBridgeMessage(type: PageBridgeMessage['type'], payload?: any): PageBridgeMessage {
  return {
    prefix: VOT_PAGE_MSG_PREFIX,
    type,
    payload
  };
}
