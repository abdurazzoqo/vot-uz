import { TranslationStrings } from './types';

export const uzStrings: TranslationStrings = {
  appName: 'VOT Uzbek',
  appDescription: 'YouTube videolarini o\'zbek tiliga sun\'iy ovoz bilan real vaqtda tarjima qilish',
  status: {
    off: 'O\'chiq',
    preparing: 'Tayyorlanmoqda...',
    translating: 'Tarjima qilinmoqda...',
    waiting: 'Kutilmoqda...', // [REVIEW NEEDED: yoki "Ovoz kutilmoqda"]
    playing: 'Ovoz berilmoqda', // [REVIEW NEEDED: yoki "Yangramoqda"]
    error: 'Xatolik'
  },
  detectedLanguage: 'Asl til',
  voice: {
    title: 'Ovoz tanlash',
    female: 'Ayol ovozi (f1)',
    male: 'Erkak ovozi (m1)',
    preview: 'Tinglash'
  },
  volume: {
    title: 'Ovoz balandligi',
    original: 'Asl video ovozi',
    dubbing: 'O\'zbekcha ovoz'
  },
  apiKey: {
    title: 'Gemini API kaliti',
    placeholder: 'API kalitingizni kiriting',
    getKeyLink: 'Google AI Studio orqali bepul kalit olish',
    checkButton: 'Tekshirish',
    checking: 'Tekshirilmoqda...',
    statusConnected: 'Ulandi',
    statusInvalid: 'Noto\'g\'ri kalit',
    statusQuota: 'Limit tugadi',
    statusNotSet: 'Kiritilmagan'
  },
  settings: {
    title: 'Qo\'shimcha sozlamalar',
    autoTranslate: 'Avtomatik tarjima',
    autoTranslateDesc: 'Yangi video ochilganda tarjimani o\'zi boshlash',
    holdVideo: 'Tarjima tayyor bo\'lguncha videoni kutish',
    holdVideoDesc: 'Tarjima audiosi tayyor bo\'lmaguncha videoni to\'xtatib turish',
    syncOffset: 'Sinxronizatsiya siljishi (sekund)',
    slowVideoSync: 'Ortda qolganda videoni sekinlashtirish',
    slowVideoSyncDesc: 'Ovoz kechikkanida videoni vaqtincha biroz sekinlashtirib tekislash', // [REVIEW NEEDED]
    language: 'Interfeys tili',
    debugMode: 'Nosozliklarni tuzatish rejimi (Debug)'
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
    tooltipOn: 'O\'zbekcha ovozli tarjima: Yoqilgan',
    tooltipOff: 'O\'zbekcha ovozli tarjima: O\'chiq'
  },
  onboarding: {
    title: 'VOT Uzbek dasturiga xush kelibsiz',
    step1Title: '1. Tizimni tekshirish',
    step1Desc: 'Ovoz sintezi modeli va WebAssembly ishlashi tekshirilmoqda.',
    step1Success: 'Sintezator tayyor va tez ishlamoqda.',
    step2Title: '2. Gemini API kaliti',
    step2Desc: 'Tarjima bepul Gemini API orqali amalga oshiriladi. Kalitingiz faqat brauzeringizda saqlanadi.',
    step2LinkText: 'Google AI Studio orqali bepul olish',
    step3Title: '3. Ovozni sinash',
    step3Desc: 'Sintezlangan namunaviy gapni eshitib ko\'ring.',
    step3PlayTest: 'Namunani tinglash',
    step3Playing: 'Yangramoqda...',
    finishButton: 'Boshlash'
  },
  about: {
    title: 'Dastur haqida',
    version: 'Versiya',
    description: 'YouTube videolarini o\'zbek tiliga sun\'iy ovoz bilan tezkor va aniq tarjima qiluvchi kengaytma.',
    privacy: 'Maxfiylik va ma\'lumotlar',
    privacyText: 'Hech qanday shaxsiy ma\'lumot saqlanmaydi va uchinchi serverlarga yuborilmaydi. Faqat video qismlari Gemini API ga yuboriladi.',
    credits: 'Mualliflik huquqi va minnatdorchilik',
    ttsCredit: 'Ovoz sintezi: Gapiring modeli (Muallif: Islomov / Gapi.uz, CC BY 4.0 litsenziyasi asosida).'
  }
};
