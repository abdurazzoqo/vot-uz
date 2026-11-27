export type SupportedLocale = 'uz' | 'ru' | 'en';

export interface TranslationStrings {
  appName: string;
  appDescription: string;
  status: {
    off: string;
    preparing: string;
    translating: string;
    waiting: string;
    playing: string;
    error: string;
  };
  detectedLanguage: string;
  voice: {
    title: string;
    female: string;
    male: string;
    preview: string;
  };
  volume: {
    title: string;
    original: string;
    dubbing: string;
  };
  apiKey: {
    title: string;
    placeholder: string;
    getKeyLink: string;
    checkButton: string;
    checking: string;
    statusConnected: string;
    statusInvalid: string;
    statusQuota: string;
    statusNotSet: string;
  };
  settings: {
    title: string;
    autoTranslate: string;
    autoTranslateDesc: string;
    holdVideo: string;
    holdVideoDesc: string;
    syncOffset: string;
    slowVideoSync: string;
    slowVideoSyncDesc: string;
    language: string;
    debugMode: string;
  };
  overlay: {
    translating: string;
    waitingBuffer: string;
    cancelButton: string;
    errorGeneric: string;
    errorQuota: string;
    errorNoKey: string;
    openSettings: string;
  };
  playerButton: {
    tooltipOn: string;
    tooltipOff: string;
  };
  onboarding: {
    title: string;
    step1Title: string;
    step1Desc: string;
    step1Success: string;
    step2Title: string;
    step2Desc: string;
    step2LinkText: string;
    step3Title: string;
    step3Desc: string;
    step3PlayTest: string;
    step3Playing: string;
    finishButton: string;
  };
  about: {
    title: string;
    version: string;
    description: string;
    privacy: string;
    privacyText: string;
    credits: string;
    ttsCredit: string;
  };
}
