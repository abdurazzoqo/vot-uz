import { TranslationStrings } from './types';

export const enStrings: TranslationStrings = {
  appName: 'VOT Uzbek',
  appDescription: 'Real-time synthetic voice-over translation of YouTube videos into Uzbek',
  status: {
    off: 'Off',
    preparing: 'Preparing...',
    translating: 'Translating...',
    waiting: 'Waiting for dubbing...',
    playing: 'Dubbing active',
    error: 'Error'
  },
  detectedLanguage: 'Source language',
  voice: {
    title: 'Voice selection',
    female: 'Female voice (f1)',
    male: 'Male voice (m1)',
    preview: 'Preview'
  },
  volume: {
    title: 'Volume',
    original: 'Original video audio',
    dubbing: 'Uzbek voice-over'
  },
  apiKey: {
    title: 'Gemini API Key',
    placeholder: 'Enter your API key',
    getKeyLink: 'Get free key at Google AI Studio',
    checkButton: 'Check key',
    checking: 'Checking...',
    statusConnected: 'Connected',
    statusInvalid: 'Invalid key',
    statusQuota: 'Quota exceeded',
    statusNotSet: 'Not set'
  },
  settings: {
    title: 'Advanced Settings',
    autoTranslate: 'Auto-translate',
    autoTranslateDesc: 'Automatically begin translation when a new video starts',
    holdVideo: 'Hold video until translation is ready',
    holdVideoDesc: 'Pause video until ~10s of dubbed speech is buffered ahead',
    syncOffset: 'Sync offset (seconds)',
    slowVideoSync: 'Slow down video on lag',
    slowVideoSyncDesc: 'Temporarily reduce playback rate (0.93x) if dubbing falls behind',
    language: 'UI Language',
    debugMode: 'Debug mode'
  },
  overlay: {
    translating: 'Tarjima qilinmoqda...',
    waitingBuffer: 'Ovoz tayyorlanmoqda...',
    cancelButton: 'Bekor qilish',
    errorGeneric: 'Tarjima qilishda xatolik yuz berdi',
    errorQuota: 'Kunlik limit tugadi',
    errorNoKey: 'API kalit kiritilmagan',
    openSettings: 'Sozlamalarni ochish'
  },
  playerButton: {
    tooltipOn: 'Uzbek voice-over: On',
    tooltipOff: 'Uzbek voice-over: Off'
  },
  onboarding: {
    title: 'Welcome to VOT Uzbek',
    step1Title: '1. System Check',
    step1Desc: 'Checking speech synthesizer (TTS) and WebAssembly performance.',
    step1Success: 'Synthesizer is ready with high performance.',
    step2Title: '2. Gemini API Key',
    step2Desc: 'Speech recognition and translation use your free Gemini API key. Stored only in your local browser.',
    step2LinkText: 'Get free key from Google AI Studio',
    step3Title: '3. Audio Test',
    step3Desc: 'Listen to a sample synthesized sentence.',
    step3PlayTest: 'Play test sample',
    step3Playing: 'Playing...',
    finishButton: 'Get Started'
  },
  about: {
    title: 'About',
    version: 'Version',
    description: 'Chrome extension for real-time Uzbek voice-over translation of YouTube videos with neural TTS.',
    privacy: 'Privacy & Security',
    privacyText: 'No personal data or telemetry is collected. Only video/audio chunks are sent directly to Google Gemini API.',
    credits: 'Credits & Attribution',
    ttsCredit: 'Speech synthesis: Gapiring model (Author: Islomov / Gapi.uz, licensed under CC BY 4.0).'
  }
};
