import { TranslationStrings } from './types';

export const ruStrings: TranslationStrings = {
  appName: 'VOT Uzbek',
  appDescription: 'Закадровый синтетический перевод видео на YouTube на узбекский язык в реальном времени',
  status: {
    off: 'Выключен',
    preparing: 'Подготовка...',
    translating: 'Перевод...',
    waiting: 'Ожидание озвучки...',
    playing: 'Озвучивание',
    error: 'Ошибка'
  },
  detectedLanguage: 'Исходный язык',
  voice: {
    title: 'Выбор голоса',
    female: 'Женский голос (f1)',
    male: 'Мужской голос (m1)',
    preview: 'Прослушать'
  },
  volume: {
    title: 'Громкость',
    original: 'Оригинальный звук видео',
    dubbing: 'Узбекская озвучка'
  },
  apiKey: {
    title: 'API-ключ Gemini',
    placeholder: 'Введите ваш ключ API',
    getKeyLink: 'Получить бесплатный ключ в Google AI Studio',
    checkButton: 'Проверить',
    checking: 'Проверка...',
    statusConnected: 'Подключен',
    statusInvalid: 'Неверный ключ',
    statusQuota: 'Лимит исчерпан',
    statusNotSet: 'Не указан'
  },
  settings: {
    title: 'Расширенные настройки',
    autoTranslate: 'Автоматический перевод',
    autoTranslateDesc: 'Начинать перевод автоматически при открытии нового видео',
    holdVideo: 'Останавливать видео до готовности перевода',
    holdVideoDesc: 'Приостанавливать видео до накопления достаточного буфера озвучки (~10 с)',
    syncOffset: 'Смещение синхронизации (секунды)',
    slowVideoSync: 'Замедлять видео при отставании',
    slowVideoSyncDesc: 'Временно слегка замедлять воспроизведение видео (0.93x), если озвучка отстает',
    language: 'Язык интерфейса',
    debugMode: 'Режим отладки (Debug)'
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
    tooltipOn: 'Озвучка на узбекском: Включена',
    tooltipOff: 'Озвучка на узбекском: Выключена'
  },
  onboarding: {
    title: 'Добро пожаловать в VOT Uzbek',
    step1Title: '1. Проверка системы',
    step1Desc: 'Проверка готовности синтезатора речи (TTS) и WebAssembly.',
    step1Success: 'Синтезатор готов к работе с высокой скоростью.',
    step2Title: '2. API-ключ Gemini',
    step2Desc: 'Для распознавания и перевода используется ваш бесплатный ключ Gemini API. Он хранится только локально в браузере.',
    step2LinkText: 'Получить бесплатный ключ в Google AI Studio',
    step3Title: '3. Проверка звучания',
    step3Desc: 'Послушайте образец синтезированной речи.',
    step3PlayTest: 'Прослушать пример',
    step3Playing: 'Воспроизведение...',
    finishButton: 'Начать использование'
  },
  about: {
    title: 'О расширении',
    version: 'Версия',
    description: 'Расширение для закадрового перевода видео на YouTube на узбекский язык с помощью нейросетевого синтезатора.',
    privacy: 'Конфиденциальность и безопасность',
    privacyText: 'Расширение не собирает телеметрию и не отправляет данные на сторонние серверы. В Google Gemini передаются только фрагменты переводимого видео/аудио.',
    credits: 'Благодарности и лицензии',
    ttsCredit: 'Синтез речи: нейросетевая модель Gapiring (автор: Islomov / Gapi.uz, распространяется по лицензии CC BY 4.0).'
  }
};
