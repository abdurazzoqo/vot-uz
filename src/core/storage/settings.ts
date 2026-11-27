export interface ExtensionSettings {
  apiKey: string;
  autoTranslate: boolean;
  holdVideo: boolean;
  voice: 'f1' | 'm1';
  originalVolume: number; // 0..1, default 0.15 (ducked level)
  dubbingVolume: number;  // 0..1, default 1.0
  syncOffset: number;     // -3..+3, default 0
  slowVideoSync: boolean; // default true
  theme: 'auto' | 'light' | 'dark';
  debugMode: boolean;
  onboardingComplete: boolean;
  dailyRequestsCount: number;
  lastRequestDate: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiKey: '',
  autoTranslate: true,
  holdVideo: true,
  voice: 'f1',
  originalVolume: 0.15,
  dubbingVolume: 1.0,
  syncOffset: 0,
  slowVideoSync: true,
  theme: 'auto',
  debugMode: false,
  onboardingComplete: false,
  dailyRequestsCount: 0,
  lastRequestDate: ''
};

export async function getSettings(): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { ...DEFAULT_SETTINGS };
  }
  const data = await chrome.storage.local.get(null);
  return { ...DEFAULT_SETTINGS, ...data };
}

export async function updateSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { ...DEFAULT_SETTINGS, ...partial };
  }
  await chrome.storage.local.set(partial);
  return getSettings();
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.substring(0, 5) + '••••••••' + key.substring(key.length - 4);
}

export type KeyCheckResult = 'CONNECTED' | 'INVALID' | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR';

export async function checkGeminiApiKey(key: string): Promise<{ result: KeyCheckResult; message?: string }> {
  if (!key || key.trim() === '') {
    return { result: 'INVALID', message: 'Key is empty' };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(key.trim())}`;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 }
      })
    });

    if (resp.ok) {
      return { result: 'CONNECTED' };
    }

    if (resp.status === 400 || resp.status === 403) {
      const err = await resp.json().catch(() => ({}));
      const msg = err.error?.message || 'Invalid API Key';
      return { result: 'INVALID', message: msg };
    }

    if (resp.status === 429) {
      return { result: 'QUOTA_EXCEEDED', message: 'Quota exceeded for this key' };
    }

    return { result: 'NETWORK_ERROR', message: `HTTP ${resp.status}` };
  } catch (err: any) {
    return { result: 'NETWORK_ERROR', message: err.message || 'Network error' };
  }
}
