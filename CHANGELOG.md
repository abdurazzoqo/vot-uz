# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-27

### Added
- Real-time synchronous Uzbek voice-over translation for YouTube videos.
- Integration with Google Gemini API for fast speech transcription and translation.
- Neural text-to-speech synthesis running directly in the browser via WebAssembly (`onnxruntime-web`) and `gapiring`.
- Natural Uzbek male (`Anvar`) and female (`Zilola`) voices.
- YouTube player native UI integration: inline translate toggle button and translation status badge.
- Audio ducking mixer to adjust the balance between original video volume and translated voice.
- Smart gating state machine (FSM) to wait for initial translation window before unpausing.
- Rolling audio buffer with lookahead scheduling and drift compensation.
- Settings popup and dedicated options page with API key verification, voice selector, volume sliders, and sync offset controls.
- Comprehensive unit test suite covering FSM transitions, buffer management, number normalization, and window planning.
