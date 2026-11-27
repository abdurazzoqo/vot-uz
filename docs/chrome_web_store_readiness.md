# Chrome Web Store Readiness Checklist & Submission Guide

This document contains the complete metadata, permission justifications, graphic asset specifications, and compliance risk assessments required to publish **VOT UZ** on the Chrome Web Store.

---

## 1. Store Listing Metadata

### Item Title
- **Default (English):** `VOT UZ - YouTube Uzbek Voice Dubbing`
- **Uzbek Localization:** `VOT UZ - YouTube Ovozli Tarjimoni`

### Summary / Short Description (132 characters maximum)
> `Real-time AI voice-over translation and neural speech dubbing for YouTube videos into the Uzbek language.`
*(Length: 107 characters)*

### Detailed Store Description

```markdown
VOT UZ brings seamless, real-time Uzbek voice-over translation directly to YouTube!

Watch educational content, tutorials, lectures, and documentaries in natural Uzbek speech powered by Google Gemini AI and in-browser neural speech synthesis.

KEY FEATURES:
★ Real-Time AI Translation: Automatically transcribes and translates spoken English and other languages into natural Uzbek.
★ In-Browser Neural TTS: Speech is generated 100% locally on your computer via WebAssembly (Gapiring neural model) — zero audio streaming lag and complete privacy.
★ Natural Voices: Select between high-quality male (Anvar) and female (Zilola) neural voices.
★ Smart Audio Ducking: Intelligently reduces original video volume while Uzbek dubbing plays, ensuring crystal-clear speech intelligibility.
★ Native Player Integration: Adds an intuitive "Ovozli tarjima" toggle button and live status badge right inside the YouTube player controls.
★ Complete Volume Mixer: Independently customize dubbing speech volume and original background audio.

HOW TO GET STARTED:
1. Install the extension.
2. Click the VOT UZ icon in your toolbar and enter your free Google Gemini API key (obtainable in 1 minute from Google AI Studio).
3. Open any YouTube video and click the VOT UZ dubbing button on the player!

PRIVACY & SECURITY:
- No tracking, telemetry, or user profiling.
- Your API key is stored strictly on your local machine inside chrome.storage.local.
- Audio synthesis happens entirely within your browser via WebAssembly; no microphone recordings or audio files are uploaded to any external server.

DISCLAIMER:
VOT UZ is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
```

### Category
- **Primary:** `Accessibility` or `Productivity`
- **Language:** `English` (with `Uzbek` localized listing)

---

## 2. Chrome Web Store Permission Justifications

Chrome Web Store reviewers require explicit justifications for every declared permission:

| Permission | Purpose & Reviewer Justification |
| :--- | :--- |
| `storage` | Required to persist the user's Gemini API key, volume mixer levels, selected voice, and sync preferences locally in `chrome.storage.local`. |
| `tabs` | Required to track YouTube navigation events and synchronize playback state with background worker scripts. |
| `activeTab` | Required to securely inject UI controls into the active YouTube player tab upon user invocation. |
| `scripting` | Required to inject player event hooks for play/pause/seeking detection on YouTube video elements. |
| `offscreen` | Required to maintain an offscreen Web Audio API context and ONNX Runtime WebAssembly environment for uninterrupted audio playback without service worker throttling. |
| `https://www.youtube.com/*` | Core functionality: Required to attach player controls, monitor video timestamps, and adjust audio ducking on YouTube video pages. |
| `https://generativelanguage.googleapis.com/*` | Core functionality: Required to send text translation requests directly from the user's browser to the Google Gemini API using their personal API key. |
| `https://huggingface.co/*` | Setup requirement: Required to download the open-source Uzbek TTS ONNX neural model weights into browser cache storage during first run. |

---

## 3. Graphic Asset Specifications

Prepare the following visual assets for submission in the Chrome Developer Dashboard:

| Asset | Dimensions | Format | Requirement |
| :--- | :--- | :--- | :--- |
| **Store Icon** | 128 x 128 px | PNG | High resolution with 16px transparent padding around corners. |
| **Primary Screenshots** | 1280 x 800 px (or 640 x 400 px) | PNG / JPEG | Minimum 1 screenshot required (recommend 4-5 showcasing: 1. Player button active; 2. Status badge; 3. Voice selector popup; 4. Volume mixer). |
| **Small Promo Tile** | 440 x 280 px | PNG / JPEG | Appears in Chrome Web Store search results and category lists. |
| **Marquee Promo Tile** | 1400 x 560 px | PNG / JPEG | Required if applying for Web Store featured placement. |

---

## 4. Policy Risk Assessment & Mitigation

### Single Purpose Compliance
- **Requirement:** The extension must have a single, narrow, easily understood purpose.
- **Status:** **Fully Compliant.** The extension exclusively performs YouTube video translation into Uzbek. No extraneous tools, ad-blockers, or unrelated features are bundled.

### Remote Code Policy (Manifest V3)
- **Requirement:** Chrome Web Store strictly bans downloading external executable JavaScript or WASM code at runtime.
- **Status:** **Fully Compliant.** The ONNX Runtime WebAssembly binary (`ort-wasm-simd-threaded.jsep-*.wasm`) is statically packaged inside the extension zip distribution. The Hugging Face download retrieves only neural model weight tensors (`.onnx` / `.json`), which are parsed as data, not executed as code.

### Audio & Privacy Policy
- **Requirement:** Extensions handling media must declare privacy terms and provide a public privacy policy URL.
- **Status:** **Fully Compliant.** The extension does not access user microphones or capture user audio. Privacy policy is published at:
  `https://abdurazzoqo.github.io/vot-uz/privacy.html`

### Trademark Guidelines
- **Requirement:** Do not use Google or YouTube brand marks without proper disclaimers.
- **Status:** **Fully Compliant.** The extension branding is "VOT UZ", featuring custom iconography. The store description and README contain prominent trademark disclaimers.
