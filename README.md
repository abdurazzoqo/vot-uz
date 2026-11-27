<div align="center">

[English](README.md) | [O'zbekcha](README_uz.md)

# VOT UZ

**Real-time AI voice-over translation and dubbing for YouTube videos into Uzbek.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/abdurazzoqo/vot-uz/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://github.com/abdurazzoqo/vot-uz/actions/workflows/ci.yml/badge.svg)](https://github.com/abdurazzoqo/vot-uz/actions)

</div>

---

## Overview

**VOT UZ** is an open-source Google Chrome extension that translates spoken speech in YouTube videos into natural Uzbek audio dubbing in real time. Powered by Google Gemini for accurate speech translation and the local neural speech model *Gapiring* running in WebAssembly, it provides a seamless watching experience without external streaming servers.

---

## Visual Preview

<!-- SCREENSHOT / GIF PLACEHOLDER -->
> **Note for Maintainer:** Capture a 5-10 second GIF demonstrating:
> 1. Opening a YouTube video with foreign speech.
> 2. Clicking the **"O'zbekcha ovoz"** button on the YouTube player controls.
> 3. The quick "Tarjima qilinmoqda..." status appearing and automatically switching to "Tayyor".
> Place the recording as `docs/assets/demo.gif` and screenshots of the popup under `docs/assets/popup.png`.

| YouTube Player Button & Status | Settings Popup |
| :---: | :---: |
| ![Player Demo Placeholder](docs/assets/player_demo_placeholder.png) | ![Popup Screenshot Placeholder](docs/assets/popup_placeholder.png) |

---

## Features

- **Live AI Translation:** Fast context-aware translation using Google Gemini API (`gemini-2.5-flash` / `gemini-3.5-flash-lite`).
- **In-Browser Neural TTS:** Speech is synthesized 100% locally on your device via ONNX Runtime WebAssembly SIMD — fast and private.
- **Natural Voices:** Choice between natural male (`Anvar`) and female (`Zilola`) voices.
- **Native YouTube Integration:** Integrates directly into YouTube player controls with an Uzbek toggle button and live status badge.
- **Audio Ducking:** Automatically lowers original video sound (e.g. to 15%) while speech is active for pristine clarity.
- **Smart Seeking & Gate:** Holds video briefly during initial translation or jumps until audio chunks are synthesized, then resumes automatically.
- **Configurable Settings:** Fine-tune translation volume, original volume, audio sync offset, and automatic translation triggers.

---

## Installation

### Method 1: Install from Pre-built Release (Recommended)

1. Download the latest `vot-uz-chrome-v1.0.0.zip` from [Releases](https://github.com/abdurazzoqo/vot-uz/releases).
2. Unpack the `.zip` archive into a permanent folder on your computer.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click **Load unpacked** and select the unpacked folder (containing `manifest.json`).

### Method 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/abdurazzoqo/vot-uz.git
cd vot-uz

# Install dependencies
npm install

# Build production bundle
npm run build
```
The compiled extension will be in the `.output/chrome-mv3` directory. Load that directory via `chrome://extensions/`.

---

## Getting a Free Gemini API Key

VOT UZ uses Google Gemini API for translation. You can obtain a free API key from Google AI Studio in less than a minute:

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account.
3. Click **"Create API key"** and copy the generated key (starts with `AIzaSy...`).
4. Open the VOT UZ popup by clicking the extension icon in Chrome toolbar.
5. Paste your key into the **"Gemini API kaliti"** field and click **"Tekshirish"** (Verify).
6. Click **"Saqlash"** (Save).

Your API key is saved exclusively in your browser's private local storage.

---

## Usage

1. Open any video on [YouTube](https://www.youtube.com).
2. Look at the video player control bar (next to the volume or subtitle buttons).
3. Click the **VOT UZ** button to enable or disable dubbing.
4. A status pill at the top-left will show translation progress and automatically disappear once dubbing begins.

---

## Settings Reference

Click the extension icon in the Chrome toolbar to access:
- **Ovozli tarjimani faollashtirish:** Master on/off toggle.
- **Ovoz tanlash:** Select between Male (`Anvar`) and Female (`Zilola`) neural voices.
- **Ovoz balandligi (Mikser):** Sliders for translated dubbing volume (0-100%) and original video background volume (0-100%).
- **Qo'shimcha sozlamalar (Advanced):**
  - *Avtomatik tarjima:* Automatically start dubbing upon opening any video.
  - *Videoni kutish (Gate):* Pause playback until the initial audio buffer is ready.
  - *Sekinlashtirish bilan sinxron:* Micro-adjust video playback rate if audio lags behind speech.
  - *Sinxron siljishi (Offset):* Manually shift audio timing by ±3.0 seconds.

---

## FAQ

#### Is the extension free to use?
Yes, the extension is 100% free and open-source under the MIT license. Google AI Studio offers a free quota for Gemini API that easily accommodates regular video watching.

#### Does audio synthesis work offline?
Once the neural voice model is downloaded during first use (~30 MB stored in browser cache), speech synthesis runs locally without internet access. However, translation requires an active connection to the Gemini API.

#### Why is there a brief pause when I seek on the timeline?
The extension fetches translation and synthesizes high-quality audio for the new position. This process typically takes 1 to 2 seconds.

---

## Limitations

- The extension currently targets desktop Chromium browsers (Chrome, Edge, Brave).
- Video dubbing depends on clear spoken audio in the source video.
- Live streams and YouTube Shorts are currently in experimental support.

---

## Privacy Policy Summary

- **No Tracking:** We collect zero telemetry, tracking data, or personal metrics.
- **Local API Key:** Your Gemini API key is stored only inside your browser (`chrome.storage.local`).
- **Data Sent:** Only the video URL and the requested timestamp range are transmitted to Google's Gemini API endpoints.
- **Local Audio Synthesis:** All voice waveforms are computed inside your browser via WebAssembly; no audio is sent to third-party servers.

For full details, see [docs/privacy.md](docs/privacy.md).

---

## Disclaimer

This project is an independent open-source tool and is **not affiliated with, sponsored by, or endorsed by Google LLC or YouTube**. All trademarks and registered trademarks belong to their respective owners.

---

## Credits & Acknowledgments

- **Speech Synthesis:** [Gapiring](https://github.com/islomov/gapiring) neural Uzbek TTS model by Islomov / Gapi.uz ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- **Translation Engine:** Google Gemini API (Google AI Studio).
- **Inference Runtime:** ONNX Runtime Web by Microsoft Corporation.
