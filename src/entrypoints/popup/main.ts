import { getSettings, updateSettings, checkGeminiApiKey, maskApiKey, ExtensionSettings } from '@/core/storage/settings';

let currentSettings: ExtensionSettings;
let audioPreviewTimer: any = null;

// DOM Elements
const statusPill = document.getElementById('statusPill') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const masterToggle = document.getElementById('masterToggle') as HTMLInputElement;

const voiceCardM1 = document.getElementById('voiceCardM1') as HTMLElement;
const voiceCardF1 = document.getElementById('voiceCardF1') as HTMLElement;

const dubVolSlider = document.getElementById('dubVolSlider') as HTMLInputElement;
const dubVolVal = document.getElementById('dubVolVal') as HTMLElement;
const origVolSlider = document.getElementById('origVolSlider') as HTMLInputElement;
const origVolVal = document.getElementById('origVolVal') as HTMLElement;
const resetMixerBtn = document.getElementById('resetMixerBtn') as HTMLButtonElement;

const apiKeyInput = document.getElementById('apiKeyInput') as HTMLInputElement;
const toggleKeyVisBtn = document.getElementById('toggleKeyVisBtn') as HTMLButtonElement;
const checkKeyBtn = document.getElementById('checkKeyBtn') as HTMLButtonElement;
const keyStatusMsg = document.getElementById('keyStatusMsg') as HTMLElement;

const autoTranslateToggle = document.getElementById('autoTranslateToggle') as HTMLInputElement;
const holdVideoToggle = document.getElementById('holdVideoToggle') as HTMLInputElement;
const slowVideoToggle = document.getElementById('slowVideoToggle') as HTMLInputElement;
const syncOffsetSlider = document.getElementById('syncOffsetSlider') as HTMLInputElement;
const syncOffsetVal = document.getElementById('syncOffsetVal') as HTMLElement;
const debugModeToggle = document.getElementById('debugModeToggle') as HTMLInputElement;

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;

const onboardingOverlay = document.getElementById('onboardingOverlay') as HTMLElement;
const obCloseBtn = document.getElementById('obCloseBtn') as HTMLButtonElement;
const obStartBtn = document.getElementById('obStartBtn') as HTMLButtonElement;

async function init() {
  currentSettings = await getSettings();

  applySettingsToUI();
  setupEventListeners();

  // If first install and no key set, show onboarding modal
  if (!currentSettings.onboardingComplete && !currentSettings.apiKey) {
    onboardingOverlay.classList.remove('hidden');
  }
}

function applySettingsToUI() {
  masterToggle.checked = currentSettings.autoTranslate;
  autoTranslateToggle.checked = currentSettings.autoTranslate;
  holdVideoToggle.checked = currentSettings.holdVideo;
  slowVideoToggle.checked = currentSettings.slowVideoSync;
  debugModeToggle.checked = currentSettings.debugMode;

  // Sliders
  dubVolSlider.value = Math.round(currentSettings.dubbingVolume * 100).toString();
  dubVolVal.textContent = Math.round(currentSettings.dubbingVolume * 100) + '%';
  origVolSlider.value = Math.round(currentSettings.originalVolume * 100).toString();
  origVolVal.textContent = Math.round(currentSettings.originalVolume * 100) + '%';
  syncOffsetSlider.value = currentSettings.syncOffset.toString();
  syncOffsetVal.textContent = (currentSettings.syncOffset > 0 ? '+' : '') + currentSettings.syncOffset.toFixed(1) + ' s';

  // Status Pill
  updateStatusPill(currentSettings.autoTranslate);

  // Voice Selection
  selectVoiceUI(currentSettings.voice || 'f1');

  // API Key
  if (currentSettings.apiKey) {
    apiKeyInput.value = maskApiKey(currentSettings.apiKey);
    keyStatusMsg.textContent = '✓ Ulangan';
    keyStatusMsg.className = 'key-status-text success';
  } else {
    apiKeyInput.value = '';
    keyStatusMsg.textContent = 'Kiritilmagan';
    keyStatusMsg.className = 'key-status-text';
  }
}

function updateStatusPill(active: boolean) {
  if (active) {
    statusPill.className = 'status-pill ready';
    statusText.textContent = 'Tayyor';
  } else {
    statusPill.className = 'status-pill inactive';
    statusText.textContent = 'Faolsiz';
  }
}

function selectVoiceUI(voice: 'm1' | 'f1') {
  if (voice === 'm1') {
    voiceCardM1.classList.add('active');
    voiceCardF1.classList.remove('active');
  } else {
    voiceCardF1.classList.add('active');
    voiceCardM1.classList.remove('active');
  }
}

function setupEventListeners() {
  // Master switch
  masterToggle.addEventListener('change', async () => {
    const val = masterToggle.checked;
    currentSettings.autoTranslate = val;
    autoTranslateToggle.checked = val;
    updateStatusPill(val);
    await updateSettings({ autoTranslate: val });
  });

  autoTranslateToggle.addEventListener('change', async () => {
    const val = autoTranslateToggle.checked;
    currentSettings.autoTranslate = val;
    masterToggle.checked = val;
    updateStatusPill(val);
    await updateSettings({ autoTranslate: val });
  });

  // Voice Cards selection
  voiceCardM1.addEventListener('click', async () => {
    currentSettings.voice = 'm1';
    selectVoiceUI('m1');
    await updateSettings({ voice: 'm1' });
  });

  voiceCardF1.addEventListener('click', async () => {
    currentSettings.voice = 'f1';
    selectVoiceUI('f1');
    await updateSettings({ voice: 'f1' });
  });

  // Mixer Sliders
  dubVolSlider.addEventListener('input', async () => {
    const pct = Number(dubVolSlider.value);
    dubVolVal.textContent = pct + '%';
    currentSettings.dubbingVolume = pct / 100;
    await updateSettings({ dubbingVolume: currentSettings.dubbingVolume });
  });

  origVolSlider.addEventListener('input', async () => {
    const pct = Number(origVolSlider.value);
    origVolVal.textContent = pct + '%';
    currentSettings.originalVolume = pct / 100;
    await updateSettings({ originalVolume: currentSettings.originalVolume });
  });

  resetMixerBtn.addEventListener('click', async () => {
    dubVolSlider.value = '100';
    dubVolVal.textContent = '100%';
    origVolSlider.value = '15';
    origVolVal.textContent = '15%';
    currentSettings.dubbingVolume = 1.0;
    currentSettings.originalVolume = 0.15;
    await updateSettings({ dubbingVolume: 1.0, originalVolume: 0.15 });
  });

  // API Key Toggle Eye
  toggleKeyVisBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      if (apiKeyInput.value.includes('••••')) {
        apiKeyInput.value = currentSettings.apiKey;
      }
    } else {
      apiKeyInput.type = 'password';
      if (currentSettings.apiKey && apiKeyInput.value === currentSettings.apiKey) {
        apiKeyInput.value = maskApiKey(currentSettings.apiKey);
      }
    }
  });

  // Check API Key button
  checkKeyBtn.addEventListener('click', async () => {
    const rawVal = apiKeyInput.value.trim();
    const key = rawVal.includes('••••') ? currentSettings.apiKey : rawVal;

    keyStatusMsg.textContent = "Tekshirilmoqda...";
    keyStatusMsg.className = 'key-status-text';

    const check = await checkGeminiApiKey(key);
    if (check.result === 'CONNECTED') {
      keyStatusMsg.textContent = '✓ Ulangan';
      keyStatusMsg.className = 'key-status-text success';
      await updateSettings({ apiKey: key });
      currentSettings.apiKey = key;
      apiKeyInput.value = maskApiKey(key);
    } else if (check.result === 'INVALID') {
      keyStatusMsg.textContent = '✕ Noto\'g\'ri kalit';
      keyStatusMsg.className = 'key-status-text error';
    } else if (check.result === 'QUOTA_EXCEEDED') {
      keyStatusMsg.textContent = '⚠ Kvota tugagan';
      keyStatusMsg.className = 'key-status-text warning';
    } else {
      keyStatusMsg.textContent = '✕ ' + (check.message || 'Xatolik yuz berdi');
      keyStatusMsg.className = 'key-status-text error';
    }
  });

  // Advanced toggles
  holdVideoToggle.addEventListener('change', async () => {
    currentSettings.holdVideo = holdVideoToggle.checked;
    await updateSettings({ holdVideo: currentSettings.holdVideo });
  });

  slowVideoToggle.addEventListener('change', async () => {
    currentSettings.slowVideoSync = slowVideoToggle.checked;
    await updateSettings({ slowVideoSync: currentSettings.slowVideoSync });
  });

  syncOffsetSlider.addEventListener('input', async () => {
    const val = Number(syncOffsetSlider.value);
    syncOffsetVal.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + ' s';
    currentSettings.syncOffset = val;
    await updateSettings({ syncOffset: val });
  });

  debugModeToggle.addEventListener('change', async () => {
    currentSettings.debugMode = debugModeToggle.checked;
    await updateSettings({ debugMode: currentSettings.debugMode });
  });

  // Save Button
  saveBtn.addEventListener('click', async () => {
    saveBtn.textContent = 'Saqlandi ✓';
    saveBtn.classList.add('saved');
    setTimeout(() => {
      saveBtn.textContent = 'Saqlash';
      saveBtn.classList.remove('saved');
    }, 1500);
  });

  // Accordion auto-scroll into view when opened
  const accordions = document.querySelectorAll<HTMLDetailsElement>('details.accordion');
  accordions.forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        setTimeout(() => {
          details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      }
    });
  });

  // Onboarding modal events
  obCloseBtn.addEventListener('click', async () => {
    onboardingOverlay.classList.add('hidden');
    await updateSettings({ onboardingComplete: true });
  });

  obStartBtn.addEventListener('click', async () => {
    onboardingOverlay.classList.add('hidden');
    await updateSettings({ onboardingComplete: true });
  });
}

document.addEventListener('DOMContentLoaded', init);
