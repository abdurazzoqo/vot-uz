import { defineBackground } from 'wxt/utils/define-background';
import { getSettings, updateSettings } from '@/core/storage/settings';
import { ExtensionMessage } from '@/core/protocol/messages';

export default defineBackground(() => {
  console.log('[VOT-UZ Background] Service worker initialized');

  let isWarmingUp = false;

  async function ensureOffscreenDocument(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.offscreen) return false;
    try {
      const existing = await chrome.offscreen.hasDocument();
      if (!existing) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK', 'WORKERS'],
          justification: 'Synthesize speech with WebAssembly ONNX model and stream audio'
        });
        console.log('[VOT-UZ Background] Offscreen document created');
      }
      return true;
    } catch (e) {
      console.warn('[VOT-UZ Background] Failed to create offscreen document:', e);
      return false;
    }
  }

  async function triggerWarmup() {
    if (isWarmingUp) return;
    isWarmingUp = true;
    try {
      const ok = await ensureOffscreenDocument();
      if (ok) {
        chrome.runtime.sendMessage({ type: 'TTS_WARMUP' }, (res) => {
          if (chrome.runtime.lastError) {
            // ignore if not ready yet
          } else {
            console.log('[VOT-UZ Background] TTS Warmup result:', res);
          }
          isWarmingUp = false;
        });
      } else {
        isWarmingUp = false;
      }
    } catch {
      isWarmingUp = false;
    }
  }

  // Preload and warm up when extension loads or a YouTube tab opens
  chrome.runtime.onInstalled.addListener(() => {
    triggerWarmup();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.includes('youtube.com/watch')) {
      triggerWarmup();
    }
  });

  // Handle messages from content scripts and popup
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_SETTINGS': {
        getSettings().then((settings) => sendResponse({ settings }));
        return true;
      }
      case 'UPDATE_SETTINGS': {
        updateSettings(message.settings).then((settings) => sendResponse({ settings }));
        return true;
      }
      case 'ENSURE_OFFSCREEN': {
        ensureOffscreenDocument().then((ok) => sendResponse({ ok }));
        return true;
      }
      case 'TTS_WARMUP': {
        ensureOffscreenDocument();
        // Allow offscreen listener to handle TTS_WARMUP and respond
        return false;
      }
      // TTS_SYNTHESIZE and TTS_CANCEL are directly handled by offscreen.html
      default:
        return false;
    }
  });
});
