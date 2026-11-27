# Privacy Policy for VOT UZ

*Last updated: November 27, 2026*

VOT UZ ("we", "our", or "the extension") is an open-source browser extension designed to translate and voice-over YouTube videos into the Uzbek language in real time. We believe in complete transparency and user privacy.

---

## 1. Information We Do NOT Collect
- We do not collect, store, or sell any personal identifying information.
- We do not run any analytics, tracking scripts, or telemetry.
- We do not operate external intermediate servers or logging backends.

---

## 2. API Keys and Storage
- **Google Gemini API Key:** The API key entered by the user is stored strictly on the user's local machine inside `chrome.storage.local`.
- The API key is never shared, transmitted to third parties, or uploaded to any server other than the official Google Gemini API endpoint (`generativelanguage.googleapis.com`) for translation requests.

---

## 3. Data Transmitted to External Services
When you enable dubbing on a video, the extension communicates directly from your browser to:
- **Google Gemini API:** The extension transmits the YouTube video URL and the requested time window (start and end timestamps) to request translation text into Uzbek.
- **Hugging Face Hub:** On initial installation, the extension downloads the open-source Uzbek TTS neural model bundle into the browser's local Cache Storage. No user data is sent during this download.

---

## 4. Local Processing
All speech synthesis (converting Uzbek translated text into audio waveforms) is performed **100% locally within your browser** using WebAssembly and ONNX Runtime Web. No audio or voice recordings are uploaded to external servers.

---

## 5. Contact
For any questions regarding this privacy policy or the extension, please open an issue on GitHub or reach out to:
`360958645+abdurazzoqo@users.noreply.github.com`
