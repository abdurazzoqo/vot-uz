import { defineContentScript } from 'wxt/utils/define-content-script';
import { SessionMachine } from '@/core/fsm/session-machine';
import { getSettings, ExtensionSettings } from '@/core/storage/settings';
import { getStrings } from '@/core/i18n';
import { isPageBridgeMessage, createPageBridgeMessage } from '@/core/protocol/messages';
import { MachineEffect } from '@/core/fsm/types';
import { WindowPlanner } from '@/core/scheduler/window-planner';
import { PriorityScheduler } from '@/core/scheduler/priority-scheduler';
import { GeminiTextSource } from '@/core/text-source/gemini-source';
import { TranslationCache } from '@/core/cache/translation-cache';
import { DebugOverlay } from '@/core/ui/debug-overlay';
import { TranslatedSentence } from '@/core/text-source/types';
import { RollingBuffer } from '@/core/tts/rolling-buffer';
import { AudioSyncController } from '@/core/sync/sync-controller';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    console.log('[VOT-UZ Content] Injected into ISOLATED world');

    let machine: SessionMachine | null = null;
    let settings: ExtensionSettings | null = null;
    let overlayEl: HTMLElement | null = null;
    const debugOverlay = new DebugOverlay();

    const planner = new WindowPlanner([25, 30, 35, 35, 35]);
    const cache = new TranslationCache();
    const textSource = new GeminiTextSource('gemini-3.5-flash-lite');
    const rollingBuffer = new RollingBuffer({ horizonAheadSec: 90, keepBehindSec: 120 });
    const syncController = new AudioSyncController({
      duckLevel: 0.15,
      dubbingVolume: 1.0,
      syncOffset: 0,
      slowVideoSync: true,
      onDuckChange: (duck, duckLevel) => {
        if (!duck && machine && (machine.getState() === 'playing' || machine.getState() === 'gated' || machine.getState() === 'seeking_gated')) {
          return;
        }
        window.postMessage(createPageBridgeMessage('SET_DUCKING', { duck, duckLevel }), '*');
      },
      onVideoRateAdjust: (targetRate) => {
        window.postMessage(createPageBridgeMessage('ADJUST_VIDEO_RATE', { rate: targetRate }), '*');
      },
      onSentenceStart: (clip, lag, _speedFactor) => {
        if (settings?.debugMode) {
          debugOverlay.addSentence(clip.text, clip.start, lag);
          debugOverlay.update({
            avgLag: syncController.getAverageLag(),
            queueSize: syncController.getQueueLength()
          });
        }
      },
      onClipDropped: (id, lag) => {
        console.warn(`[VOT-UZ Sync] Dropped late clip ${id} with lag ${lag.toFixed(2)}s`);
      }
    });

    let translatedSentences: TranslatedSentence[] = [];
    let cacheHits = 0;
    let timeToFirstAudioMs: number | null = null;
    let sessionStartTime = 0;
    let isSubtitlesOnlyMode = false;
    let isSynthesizingTts = false;
    let isPrefetching = false;
    let currentTtsEpoch = 0;
    let currentSeekToken = 0;

    function getAccurateDuration(fallbackTime = 0): number {
      const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
      const liveDur = (video?.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 0;
      if (liveDur > 0) {
        if (machine) machine.updateDuration(liveDur);
        return liveDur;
      }
      const ctxDur = machine?.getContext().duration || 0;
      if (ctxDur > 0) return ctxDur;
      return fallbackTime > 0 ? fallbackTime + 600 : 0;
    }

    async function checkAndPrefetchWindows(vTime: number, _duration?: number) {
      if (isPrefetching || !machine || !settings?.apiKey) return;
      const validDuration = getAccurateDuration(vTime);
      const furthest = scheduler.getFurthestEnd();
      if (furthest < vTime + 240 && (validDuration === 0 || furthest < validDuration)) {
        isPrefetching = true;
        try {
          const start = Math.max(vTime, furthest);
          const windows = planner.planWindows(start, validDuration, 300);
          const toQueue = [];
          for (const w of windows) {
            const cached = await cache.get(machine.getContext().videoId, w.startSec, w.endSec);
            if (cached && cached.length > 0) {
              cacheHits++;
              translatedSentences = planner.dedupeSentences([...translatedSentences, ...cached]);
              rollingBuffer.addSentences(cached);
              rollingBuffer.markWindowCovered(w.startSec, w.endSec);
            } else {
              toQueue.push(w);
            }
          }
          if (toQueue.length > 0) {
            scheduler.enqueueWindows(toQueue);
          }
        } finally {
          isPrefetching = false;
        }
      }
    }

    // Tick loop for precise Web Audio playback scheduling & continuous background dubbing pump
    let tickCount = 0;
    setInterval(() => {
      const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
      if (video && machine) {
        const vTime = video.currentTime;
        const vRate = video.playbackRate;
        const isPaused = video.paused;
        const state = machine.getState();

        if (state === 'playing') {
          syncController.tick(vTime, vRate, isPaused);
          pumpTtsSynthesis(vTime);

          // If video is playing and state is playing, make sure any leftover waiting overlay is hidden!
          if (!isPaused && overlayEl && overlayEl.style.display !== 'none' && !hideReadyTimeoutId) {
            const textSpan = overlayEl.querySelector('.vot-overlay-text');
            if (textSpan && (textSpan.textContent?.includes('%') || textSpan.textContent?.includes('Tarjima qilinmoqda'))) {
              showReadyOverlay();
            }
          }

          tickCount++;
          // Every ~500ms, update scheduler playhead and check prefetching
          if (tickCount % 14 === 0) {
            scheduler.updatePlayhead(vTime);
            const accurateDur = getAccurateDuration(vTime);
            checkAndPrefetchWindows(vTime, accurateDur);

            // Buffer starvation check during playback:
            if (settings?.holdVideo && !isPaused && (accurateDur - vTime > 3.0 || accurateDur === 0)) {
              const readySec = rollingBuffer.computeReadyDurationAhead(vTime, scheduler.getFurthestEnd());
              const hasAudio = rollingBuffer.hasAudioFor(vTime);
              const isSilence = rollingBuffer.isCoveredSilence(vTime);

              // Pause immediately if speech is missing and not confirmed silence
              if (!hasAudio && !isSilence && readySec < 0.8) {
                console.warn(`[VOT-UZ Content] Dubbing starvation at ${vTime.toFixed(1)}s! Holding video...`);
                machine.dispatch({ type: 'BUFFER_STARVED' });
                const s = getStrings();
                const percent = Math.min(100, Math.round((readySec / 2.0) * 100));
                showOverlay('waiting', `${s.overlay.translating} (${percent}%)`);
              }
            }
          }
        } else if (state === 'gated' || state === 'seeking_gated' || state === 'preparing') {
          pumpTtsSynthesis(vTime);

          // Check if dubbing audio is already ready ahead or current timestamp is covered silence
          const readySec = rollingBuffer.computeReadyDurationAhead(vTime, scheduler.getFurthestEnd());
          const hasAudio = rollingBuffer.hasAudioFor(vTime);
          const isSilence = rollingBuffer.isCoveredSilence(vTime);

          if (readySec >= 2.0 || hasAudio || isSilence) {
            machine.dispatch({
              type: 'BUFFER_UPDATE',
              readySecondsAhead: Math.max(readySec, 2.0)
            });
          } else {
            if (settings?.holdVideo && !isPaused) {
              video.pause();
            }
            const s = getStrings();
            const percent = Math.min(100, Math.round((readySec / 2.0) * 100));
            showOverlay('waiting', `${s.overlay.translating} (${percent}%)`);
          }
        }
      }
    }, 35);

    const scheduler = new PriorityScheduler({
      textSource,
      maxConcurrency: 2,
      prefetchLimitSeconds: 600,
      callbacks: {
        onWindowSuccess: async (window, sentences, sourceUsed, latencyMs) => {
          console.log(`[VOT-UZ Scheduler] Window [${window.startSec}s - ${window.endSec}s] done via ${sourceUsed} in ${latencyMs.toFixed(0)}ms (${sentences.length} sentences)`);

          let effectiveCoveredEnd = window.endSec;

          if (sentences.length > 0) {
            const sortedSentences = [...sentences].sort((a, b) => a.start - b.start);
            const lastSentence = sortedSentences[sortedSentences.length - 1];

            // If Gemini stopped early leaving an uncovered tail (> 3.5s missing):
            if (window.endSec - lastSentence.end > 3.5) {
              console.warn(`[VOT-UZ Scheduler] Window [${window.startSec}s - ${window.endSec}s] truncated early at ${lastSentence.end}s. Queueing gap-fill [${lastSentence.end}s - ${window.endSec}s]`);
              effectiveCoveredEnd = Number((lastSentence.end + 1.0).toFixed(2));

              const gapStart = Number(lastSentence.end.toFixed(2));
              const gapEnd = window.endSec;
              scheduler.enqueueWindows([{
                index: window.index + 5000,
                startSec: gapStart,
                endSec: gapEnd,
                duration: Number((gapEnd - gapStart).toFixed(2))
              }]);
            }
          }

          // Record covered window span only up to effectiveCoveredEnd
          rollingBuffer.markWindowCovered(window.startSec, effectiveCoveredEnd);

          // Save to IndexedDB cache
          if (settings?.apiKey && machine) {
            await cache.set(machine.getContext().videoId, window.startSec, window.endSec, sentences);
          }

          // Merge and deduplicate sentences
          translatedSentences = planner.dedupeSentences([...translatedSentences, ...sentences]);
          rollingBuffer.addSentences(sentences);

          // Get current video playhead
          const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
          const curTime = video?.currentTime ?? (machine?.getContext().currentTime ?? 0);

          // Pump TTS synthesis
          pumpTtsSynthesis(curTime);

          // Calculate buffer ready ahead from rollingBuffer audio
          const readySecondsAhead = rollingBuffer.computeReadyDurationAhead(curTime, scheduler.getFurthestEnd());

          // Notify state machine
          if (machine) {
            machine.dispatch({
              type: 'BUFFER_UPDATE',
              readySecondsAhead
            });

            // If still waiting, update overlay with percentage
            const curState = machine.getState();
            if (curState === 'gated' || curState === 'seeking_gated' || curState === 'preparing') {
              const isSilence = rollingBuffer.isCoveredSilence(curTime);
              if (readySecondsAhead >= 2.0 || isSilence) {
                machine.dispatch({
                  type: 'BUFFER_UPDATE',
                  readySecondsAhead: Math.max(readySecondsAhead, 2.0)
                });
              } else {
                const s = getStrings();
                const percent = Math.min(100, Math.round((readySecondsAhead / 2.0) * 100));
                showOverlay('waiting', `${s.overlay.translating} (${percent}%)`);
              }
            }
          }

          // Update debug overlay
          if (settings?.debugMode) {
            const maxTranslatedEnd = translatedSentences.length > 0 ? translatedSentences[translatedSentences.length - 1].end : 0;
            debugOverlay.update({
              fsmState: machine?.getState() ?? 'idle',
              textSource: sourceUsed,
              lastWindowLatencyMs: latencyMs,
              timeToFirstAudioMs,
              queueSize: scheduler.getQueueLength(),
              translatedRange: `0.0s - ${maxTranslatedEnd.toFixed(1)}s`,
              cacheHits
            });
          }
        },
        onWindowError: (window, err) => {
          const isAbort = err.name === 'AbortError' || err.message === 'Aborted' || err.message?.toLowerCase().includes('abort');
          if (isAbort) return;

          const errMsg = err.message || '';
          if (errMsg.includes('empty') || errMsg.includes('corrupted') || errMsg.includes('malformed')) {
            console.warn(`[VOT-UZ Scheduler] Window [${window.startSec}s - ${window.endSec}s] hit media boundary, treating as silence.`);
            rollingBuffer.markWindowCovered(window.startSec, window.endSec);
            return;
          }

          console.error(`[VOT-UZ Scheduler] Window [${window.startSec}s - ${window.endSec}s] error:`, err);
          if (machine) {
            machine.dispatch({
              type: 'ERROR',
              message: err.message
            });
          }
        }
      }
    });

    async function pumpTtsSynthesis(currentTime: number) {
      if (isSynthesizingTts || isSubtitlesOnlyMode) return;
      if (!settings?.apiKey) return;

      const pendingList = rollingBuffer.updatePlayhead(currentTime);
      if (pendingList.length === 0) return;

      const nextItem = pendingList[0];
      rollingBuffer.markSynthesizing(nextItem.id);
      isSynthesizingTts = true;
      const thisEpoch = currentTtsEpoch;

      // 30-second watchdog timer to prevent isSynthesizingTts from ever staying stuck
      const timeoutTimer = setTimeout(() => {
        if (isSynthesizingTts && thisEpoch === currentTtsEpoch) {
          console.warn(`[VOT-UZ Content] TTS synthesis timed out for ${nextItem.id}`);
          isSynthesizingTts = false;
          const item = rollingBuffer.getItem(nextItem.id);
          if (item && item.status === 'SYNTHESIZING') {
            item.status = 'PENDING';
          }
          const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
          pumpTtsSynthesis(video?.currentTime ?? currentTime);
        }
      }, 30000);

      try {
        chrome.runtime.sendMessage({
          type: 'TTS_SYNTHESIZE',
          sentenceId: nextItem.id,
          text: nextItem.uz,
          voice: settings.voice || 'f1'
        }, (res) => {
          clearTimeout(timeoutTimer);
          if (thisEpoch !== currentTtsEpoch) {
            isSynthesizingTts = false;
            return;
          }
          isSynthesizingTts = false;
          if (chrome.runtime.lastError || !res || !res.ok) {
            console.warn('[VOT-UZ Content] TTS synthesis failed:', chrome.runtime.lastError || res?.error);
            const item = rollingBuffer.getItem(nextItem.id);
            if (item && item.status === 'SYNTHESIZING') {
              item.status = 'PENDING';
            }
            return;
          }

          if (res.subtitlesOnly) {
            isSubtitlesOnlyMode = true;
            showOverlay('waiting', "Past tezlik: faqat subtitrlar rejimi");
            return;
          }

          if (res.ok && res.audioData) {
            if (timeToFirstAudioMs === null && sessionStartTime > 0) {
              timeToFirstAudioMs = Date.now() - sessionStartTime;
            }

            const floatAudio = new Float32Array(res.audioData);
            rollingBuffer.setAudio(res.sentenceId, floatAudio, res.sampleRate);
            syncController.addClip({
              id: res.sentenceId,
              start: nextItem.start,
              end: nextItem.end,
              text: nextItem.uz,
              audioData: floatAudio,
              sampleRate: res.sampleRate,
              durationSec: res.duration
            });
            console.log(`[VOT-UZ Content] TTS ready for [${nextItem.start}s - ${nextItem.end}s], audio: ${res.duration.toFixed(2)}s`);

            // Compute audio readiness and notify FSM
            const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
            const vTime = video?.currentTime ?? currentTime;
            const readyAudioSec = rollingBuffer.computeReadyDurationAhead(vTime, scheduler.getFurthestEnd());

            if (machine) {
              const state = machine.getState();
              if (state === 'gated' || state === 'seeking_gated' || state === 'preparing') {
                machine.dispatch({
                  type: 'BUFFER_UPDATE',
                  readySecondsAhead: readyAudioSec
                });

                // ONLY update waiting overlay if we are STILL in a gated/preparing state!
                const newState = machine.getState();
                if (newState === 'gated' || newState === 'seeking_gated' || newState === 'preparing') {
                  const s = getStrings();
                  const percent = Math.min(100, Math.round((readyAudioSec / 2.0) * 100));
                  showOverlay('waiting', `${s.overlay.translating} (${percent}%)`);
                }
              }
            }

            // Update debug overlay
            if (settings?.debugMode) {
              debugOverlay.update({
                timeToFirstAudioMs,
                ttsSpeedFactor: res.duration / (res.latencyMs / 1000)
              });
            }

            // Pump next pending sentence immediately!
            pumpTtsSynthesis(vTime);
          }
        });
      } catch (e) {
        clearTimeout(timeoutTimer);
        if (thisEpoch === currentTtsEpoch) {
          isSynthesizingTts = false;
          const item = rollingBuffer.getItem(nextItem.id);
          if (item && item.status === 'SYNTHESIZING') {
            item.status = 'PENDING';
          }
        }
      }
    }

    // Load initial settings
    getSettings().then((s) => {
      applySettings(s);
      checkExistingVideo();
      window.postMessage(createPageBridgeMessage('REQUEST_VIDEO_STATUS', {}), '*');
    });

    function checkExistingVideo() {
      const url = new URL(window.location.href);
      const videoId = url.searchParams.get('v');
      const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
      if (videoId && video) {
        handleVideoDetected(videoId, video.currentTime, video.duration || 0);
      }
    }

    // Listen to storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        getSettings().then((s) => {
          applySettings(s);
        });
      }
    });

    function applySettings(s: ExtensionSettings) {
      settings = s;
      syncController.setOptions({
        duckLevel: s.originalVolume,
        dubbingVolume: s.dubbingVolume,
        syncOffset: s.syncOffset,
        slowVideoSync: s.slowVideoSync
      });
      if (s.debugMode) {
        debugOverlay.mount();
        debugOverlay.setVisible(true);
      } else {
        debugOverlay.setVisible(false);
      }
    }

    // Listen for bridge messages from MAIN world
    window.addEventListener('message', (event) => {
      if (!isPageBridgeMessage(event.data)) return;

      const { type, payload } = event.data;

      switch (type) {
        case 'VIDEO_DETECTED': {
          handleVideoDetected(payload.videoId, payload.currentTime, payload.duration);
          break;
        }
        case 'PLAYER_PLAY': {
          syncController.resume();
          if (machine) {
            machine.dispatch({ type: 'PLAY', isUserInitiated: true });
            pumpTtsSynthesis(payload.currentTime);
          }
          break;
        }
        case 'PLAYER_PAUSE': {
          syncController.pause();
          if (machine) {
            machine.dispatch({ type: 'PAUSE', isUserInitiated: true });
          }
          break;
        }
        case 'PLAYER_SEEKING': {
          if (machine) {
            machine.dispatch({ type: 'SEEKING', targetTime: payload.currentTime });
          }
          break;
        }
        case 'PLAYER_SEEKED': {
          handleSeeked(payload.currentTime);
          break;
        }
        case 'AD_STATE_CHANGE': {
          if (machine) {
            machine.dispatch(payload.isAd ? { type: 'AD_START' } : { type: 'AD_END' });
          }
          break;
        }
        case 'TOGGLE_DUBBING': {
          if (machine) {
            machine.dispatch(payload.enabled ? { type: 'ENABLE' } : { type: 'CANCEL' });
          }
          break;
        }
      }
    });

    async function handleVideoDetected(videoId: string, currentTime: number, duration: number) {
      if (!settings) {
        settings = await getSettings();
      }
      if (!settings) return;

      const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
      const validDuration = (typeof duration === 'number' && !isNaN(duration) && duration > 0)
        ? duration
        : (video?.duration && !isNaN(video.duration) && video.duration > 0 ? video.duration : 0);

      if (machine && machine.getContext().videoId === videoId && machine.getState() !== 'idle' && machine.getState() !== 'cancelled') {
        if (validDuration > 0) {
          machine.updateDuration(validDuration);
        }
        return;
      }

      console.log(`[VOT-UZ Content] Video detected: ${videoId} at ${currentTime}s (duration: ${validDuration}s)`);
      chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
      sessionStartTime = Date.now();
      timeToFirstAudioMs = null;
      translatedSentences = [];
      rollingBuffer.clear();
      syncController.stop();
      cacheHits = 0;

      // Check if API key is present
      if (!settings.apiKey) {
        showOverlay('error', getStrings().overlay.errorNoKey);
        return;
      }

      // Initialize session machine
      machine = new SessionMachine(
        {
          videoId,
          currentTime,
          duration: validDuration,
          holdVideoSetting: settings.holdVideo,
          gateThresholdSeconds: 2.0
        },
        (result, log) => {
          console.log(`[VOT-UZ FSM] ${log.fromState} -> ${log.toState} (${log.event})`, log.effects);
          handleEffects(result.effects);
          updatePlayerButtonState(result.state);

          if (settings?.debugMode) {
            debugOverlay.update({
              fsmState: result.state,
              sessionId: result.context.sessionId
            });
          }
        }
      );

      // Initialize scheduler
      scheduler.initSession(videoId, settings.apiKey, currentTime);

      if (settings.autoTranslate) {
        machine.dispatch({
          type: 'VIDEO_CHANGED',
          videoId,
          currentTime,
          duration: validDuration
        });

        // Plan initial windows
        await planAndQueueWindows(videoId, currentTime, validDuration);
      }
    }

    async function planAndQueueWindows(videoId: string, currentTime: number, duration: number) {
      const accurateDur = getAccurateDuration(currentTime) || duration;
      const windows = planner.planWindows(currentTime, accurateDur);
      console.log(`[VOT-UZ Content] Planning windows for ${videoId} at ${currentTime}s (duration: ${accurateDur}s): planned ${windows.length} windows`);
      const toQueue = [];

      for (const w of windows) {
        const cached = await cache.get(videoId, w.startSec, w.endSec);
        if (cached && cached.length > 0) {
          cacheHits++;
          console.log(`[VOT-UZ Cache] Hit for [${w.startSec}s - ${w.endSec}s] (${cached.length} sentences)`);
          translatedSentences = planner.dedupeSentences([...translatedSentences, ...cached]);
          rollingBuffer.addSentences(cached);
          rollingBuffer.markWindowCovered(w.startSec, w.endSec);
        } else {
          toQueue.push(w);
        }
      }

      // If cached sentences exist, start synthesizing them immediately
      if (translatedSentences.length > 0) {
        pumpTtsSynthesis(currentTime);
        const readySec = rollingBuffer.computeReadyDurationAhead(currentTime, scheduler.getFurthestEnd());
        const isSilence = rollingBuffer.isCoveredSilence(currentTime);
        if (readySec >= 2.0 || isSilence) {
          machine?.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: Math.max(readySec, 2.0) });
        }
      }

      // Queue remaining windows
      if (toQueue.length > 0) {
        console.log(`[VOT-UZ Content] Enqueuing ${toQueue.length} windows to scheduler (${windows.length - toQueue.length} cached)`);
        scheduler.enqueueWindows(toQueue);
      }
    }

    async function handleSeeked(newTime: number) {
      if (!machine || !settings) return;

      const seekToken = ++currentSeekToken;
      currentTtsEpoch++;
      isSynthesizingTts = false;

      // 1. Notify rolling buffer of new playhead
      rollingBuffer.onSeek(newTime);

      // 2. Clear current playing clip & lag in sync controller
      syncController.onSeek(newTime);

      // 3. Immediately repopulate syncController with all ready audio clips covering newTime and future!
      const readyClips = rollingBuffer.getReadyClipsFrom(newTime);
      for (const c of readyClips) {
        if (c.audio && c.end > newTime) {
          syncController.addClip({
            id: c.id,
            start: c.start,
            end: c.end,
            text: c.uz,
            audioData: c.audio,
            sampleRate: c.sampleRate,
            durationSec: c.durationSec
          });
        }
      }

      // 4. Check if the seeked position is within our ready buffered range
      const hasAudio = rollingBuffer.hasAudioFor(newTime);
      const readySec = rollingBuffer.computeReadyDurationAhead(newTime);
      const isWithinBuffered = hasAudio && readySec >= 2.0;

      // If seeking to an untranslated/un-buffered range, pause video immediately in the DOM!
      if (!isWithinBuffered && settings.holdVideo) {
        const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
        if (video && !video.paused) {
          video.pause();
        }
      }

      machine.dispatch({
        type: 'SEEKED',
        currentTime: newTime,
        isWithinBufferedRange: isWithinBuffered
      });

      if (!isWithinBuffered) {
        const duration = getAccurateDuration(newTime);
        const newWindows = planner.planWindows(newTime, duration);
        const toQueue = [];

        for (const w of newWindows) {
          const cached = await cache.get(machine.getContext().videoId, w.startSec, w.endSec);
          if (cached && cached.length > 0) {
            cacheHits++;
            translatedSentences = planner.dedupeSentences([...translatedSentences, ...cached]);
            rollingBuffer.addSentences(cached);
            rollingBuffer.markWindowCovered(w.startSec, w.endSec);
          } else {
            toQueue.push(w);
          }
        }

        // Abort if another seek occurred while awaiting cache
        if (seekToken !== currentSeekToken) return;

        console.log(`[VOT-UZ Content] Seek to ${newTime.toFixed(1)}s: queued ${toQueue.length} windows (${newWindows.length - toQueue.length} cached)`);
        scheduler.onSeek(newTime, toQueue);
        pumpTtsSynthesis(newTime);

        // Check if seek landed on an already ready range or covered silence:
        const readySecAfterSeek = rollingBuffer.computeReadyDurationAhead(newTime);
        const isCoveredSilence = rollingBuffer.isCoveredSilence(newTime);
        if (readySecAfterSeek >= 2.0 || isCoveredSilence) {
          machine.dispatch({ type: 'BUFFER_UPDATE', readySecondsAhead: Math.max(readySecAfterSeek, 2.0) });
        }
      } else {
        // Small seek within buffered range:
        // Audio clips are already re-added to syncController, tick loop will play them seamlessly!
        pumpTtsSynthesis(newTime);
      }
    }

    function handleEffects(effects: MachineEffect[]) {
      for (const effect of effects) {
        switch (effect.type) {
          case 'SHOW_WAITING_OVERLAY': {
            const s = getStrings();
            showOverlay('waiting', effect.text || `${s.overlay.translating} (0%)`);
            break;
          }
          case 'HIDE_WAITING_OVERLAY':
            showReadyOverlay();
            break;
          case 'SHOW_ERROR_OVERLAY':
            showOverlay('error', effect.message);
            break;
          case 'HIGHLIGHT_CANCEL_BUTTON':
            highlightCancelButton();
            break;
          case 'CANCEL_IN_FLIGHT_REQUESTS':
            scheduler.cancelAll();
            break;
          case 'FLUSH_TTS_QUEUE':
            rollingBuffer.clear();
            syncController.stop();
            isSynthesizingTts = false;
            currentTtsEpoch++;
            chrome.runtime.sendMessage({ type: 'TTS_CANCEL' });
            break;
          case 'PAUSE_VIDEO': {
            const v = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
            if (v && !v.paused) v.pause();
            window.postMessage(
              createPageBridgeMessage('EXECUTE_EFFECT', {
                effect,
                duckLevel: settings?.originalVolume ?? 0.15
              }),
              '*'
            );
            break;
          }
          case 'RESUME_VIDEO': {
            const v = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
            if (v && v.paused) v.play().catch(() => {});
            window.postMessage(
              createPageBridgeMessage('EXECUTE_EFFECT', {
                effect,
                duckLevel: settings?.originalVolume ?? 0.15
              }),
              '*'
            );
            break;
          }
          case 'MUTE_VIDEO':
          case 'UNMUTE_VIDEO':
          case 'SET_DUCKING':
            window.postMessage(
              createPageBridgeMessage('EXECUTE_EFFECT', {
                effect,
                duckLevel: settings?.originalVolume ?? 0.15
              }),
              '*'
            );
            break;
        }
      }
    }

    function updatePlayerButtonState(state: string) {
      const active = state === 'playing' || state === 'gated' || state === 'seeking_gated' || state === 'preparing';
      const preparing = state === 'gated' || state === 'seeking_gated' || state === 'preparing';
      const s = getStrings();
      const tooltip = active ? s.playerButton.tooltipOn : s.playerButton.tooltipOff;

      window.postMessage(
        createPageBridgeMessage('STATE_UPDATE', { active, preparing, tooltip }),
        '*'
      );
    }

    let hideReadyTimeoutId: any = null;

    function showReadyOverlay() {
      const el = getOrCreateOverlay();
      if (!el) return;

      if (hideReadyTimeoutId) {
        clearTimeout(hideReadyTimeoutId);
        hideReadyTimeoutId = null;
      }

      const textSpan = el.querySelector('.vot-overlay-text') as HTMLElement;
      const spinner = el.querySelector('.vot-overlay-spinner') as HTMLElement;
      const pulseRing = el.querySelector('.vot-overlay-pulse-ring') as HTMLElement;
      const readyIcon = el.querySelector('.vot-overlay-ready-icon') as HTMLElement;
      const cancelBtn = el.querySelector<HTMLButtonElement>('.vot-overlay-cancel-btn');

      if (spinner) spinner.style.display = 'none';
      if (pulseRing) pulseRing.style.display = 'none';
      if (readyIcon) readyIcon.style.display = 'block';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (textSpan) {
        textSpan.textContent = "Tayyor · O'zbekcha audio faol";
        textSpan.style.color = '#3EA6FF';
        textSpan.style.fontWeight = '600';
      }

      el.style.borderColor = '#3EA6FF';
      el.style.background = 'rgba(15, 15, 15, 0.95)';
      el.style.boxShadow = '0 4px 16px rgba(62, 166, 255, 0.25)';
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.transition = 'all 200ms ease';
      el.style.display = 'inline-flex';

      // Keep success notice visible for 3.0s, then fade out smoothly
      hideReadyTimeoutId = setTimeout(() => {
        if (el) {
          el.style.transition = 'opacity 400ms ease, transform 400ms ease';
          el.style.opacity = '0';
          el.style.transform = 'translateY(-6px)';
          setTimeout(() => {
            el.style.display = 'none';
            el.style.opacity = '1';
            el.style.transform = 'none';
            el.style.transition = 'all 200ms ease';
            el.style.background = 'rgba(15, 15, 15, 0.88)';
            el.style.borderColor = '#383838';
            el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.5)';
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            if (readyIcon) readyIcon.style.display = 'none';
            if (spinner) spinner.style.display = 'block';
            if (pulseRing) pulseRing.style.display = 'block';
            if (textSpan) {
              textSpan.style.color = '#F1F1F1';
              textSpan.style.fontWeight = '500';
            }
          }, 450);
        }
      }, 3000);
    }

    function getOrCreateOverlay(): HTMLElement | null {
      if (overlayEl && document.contains(overlayEl)) {
        return overlayEl;
      }
      const player = document.getElementById('movie_player');
      if (!player) return null;

      // Inject keyframes if missing
      if (!document.getElementById('vot-overlay-keyframes')) {
        const style = document.createElement('style');
        style.id = 'vot-overlay-keyframes';
        style.textContent = `
          @keyframes votSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes votPulseRing {
            0% { transform: scale(0.95); opacity: 0.8; }
            50% { transform: scale(1.4); opacity: 0; }
            100% { transform: scale(0.95); opacity: 0; }
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }

      let el = player.querySelector<HTMLElement>('#vot-waiting-overlay');
      if (!el) {
        el = document.createElement('div');
        el.id = 'vot-waiting-overlay';
        el.setAttribute('aria-live', 'polite');
        el.style.position = 'absolute';
        el.style.top = '16px';
        el.style.left = '16px';
        el.style.right = 'auto';
        el.style.zIndex = '60';
        el.style.display = 'none';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.padding = '6px 14px';
        el.style.borderRadius = '9999px';
        el.style.background = 'rgba(15, 15, 15, 0.88)';
        el.style.backdropFilter = 'blur(12px)';
        (el.style as any).webkitBackdropFilter = 'blur(12px)';
        el.style.color = '#F1F1F1';
        el.style.fontFamily = '"YouTube Sans", "Roboto", -apple-system, sans-serif';
        el.style.fontSize = '12px';
        el.style.fontWeight = '500';
        el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.5)';
        el.style.border = '1px solid #383838';
        el.style.pointerEvents = 'none';
        el.style.transition = 'all 200ms ease';

        // Icon Box
        const iconBox = document.createElement('div');
        iconBox.className = 'vot-overlay-icon-box';
        iconBox.style.position = 'relative';
        iconBox.style.display = 'flex';
        iconBox.style.alignItems = 'center';
        iconBox.style.justifyContent = 'center';
        iconBox.style.width = '16px';
        iconBox.style.height = '16px';

        // Pulse ring
        const pulseRing = document.createElement('span');
        pulseRing.className = 'vot-overlay-pulse-ring';
        pulseRing.style.position = 'absolute';
        pulseRing.style.width = '14px';
        pulseRing.style.height = '14px';
        pulseRing.style.borderRadius = '50%';
        pulseRing.style.background = 'rgba(62, 166, 255, 0.35)';
        pulseRing.style.animation = 'votPulseRing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite';
        iconBox.appendChild(pulseRing);

        // Spinner SVG
        const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        spinner.setAttribute('class', 'vot-overlay-spinner');
        spinner.setAttribute('viewBox', '0 0 24 24');
        spinner.setAttribute('fill', 'none');
        spinner.style.width = '14px';
        spinner.style.height = '14px';
        spinner.style.animation = 'votSpin 0.8s linear infinite';
        spinner.style.color = '#3EA6FF';

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '4');
        circle.setAttribute('opacity', '0.25');
        spinner.appendChild(circle);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('opacity', '0.85');
        path.setAttribute('d', 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z');
        spinner.appendChild(path);
        iconBox.appendChild(spinner);

        // Ready Checkmark SVG
        const readyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        readyIcon.setAttribute('class', 'vot-overlay-ready-icon');
        readyIcon.setAttribute('viewBox', '0 0 20 20');
        readyIcon.setAttribute('fill', 'currentColor');
        readyIcon.style.width = '14px';
        readyIcon.style.height = '14px';
        readyIcon.style.color = '#3EA6FF';
        readyIcon.style.display = 'none';

        const readyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        readyPath.setAttribute('fill-rule', 'evenodd');
        readyPath.setAttribute('clip-rule', 'evenodd');
        readyPath.setAttribute('d', 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z');
        readyIcon.appendChild(readyPath);
        iconBox.appendChild(readyIcon);

        el.appendChild(iconBox);

        // VOT UZ tag
        const brandTag = document.createElement('span');
        brandTag.className = 'vot-overlay-brand';
        brandTag.style.color = '#3EA6FF';
        brandTag.style.fontWeight = '700';
        brandTag.style.letterSpacing = '-0.01em';
        brandTag.textContent = 'VOT UZ:';
        el.appendChild(brandTag);

        // Status Text
        const textSpan = document.createElement('span');
        textSpan.className = 'vot-overlay-text';
        textSpan.style.color = '#F1F1F1';
        textSpan.style.fontWeight = '500';
        textSpan.textContent = 'Tarjima qilinmoqda...';
        el.appendChild(textSpan);

        // Cancel Button
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'vot-overlay-cancel-btn';
        cancelBtn.style.pointerEvents = 'auto';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.padding = '2px 8px';
        cancelBtn.style.borderRadius = '9999px';
        cancelBtn.style.background = '#272727';
        cancelBtn.style.border = '1px solid rgba(56, 56, 56, 0.8)';
        cancelBtn.style.color = '#AAAAAA';
        cancelBtn.style.fontSize = '10px';
        cancelBtn.style.fontWeight = '600';
        cancelBtn.style.marginLeft = '4px';
        cancelBtn.style.transition = 'all 150ms ease';
        cancelBtn.textContent = 'Bekor qilish';
        el.appendChild(cancelBtn);

        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (machine) {
            machine.dispatch({ type: 'CANCEL' });
          }
        });
        cancelBtn.addEventListener('mouseenter', () => {
          cancelBtn.style.background = '#383838';
          cancelBtn.style.color = '#FFFFFF';
          cancelBtn.style.borderColor = '#555555';
        });
        cancelBtn.addEventListener('mouseleave', () => {
          cancelBtn.style.background = '#272727';
          cancelBtn.style.color = '#AAAAAA';
          cancelBtn.style.borderColor = 'rgba(56, 56, 56, 0.8)';
        });

        player.appendChild(el);
      } else {
        el.style.left = '16px';
        el.style.right = 'auto';
      }
      overlayEl = el;
      return el;
    }

    function showOverlay(type: 'waiting' | 'error', text?: string) {
      const el = getOrCreateOverlay();
      if (!el) return;

      if (hideReadyTimeoutId) {
        clearTimeout(hideReadyTimeoutId);
        hideReadyTimeoutId = null;
      }

      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.transition = 'all 200ms ease';

      const s = getStrings();
      const textSpan = el.querySelector('.vot-overlay-text') as HTMLElement;
      const spinner = el.querySelector('.vot-overlay-spinner') as HTMLElement;
      const pulseRing = el.querySelector('.vot-overlay-pulse-ring') as HTMLElement;
      const readyIcon = el.querySelector('.vot-overlay-ready-icon') as HTMLElement;
      const cancelBtn = el.querySelector<HTMLButtonElement>('.vot-overlay-cancel-btn');

      if (cancelBtn) {
        cancelBtn.textContent = s.overlay.cancelButton;
        cancelBtn.style.display = 'inline-block';
      }

      if (readyIcon) readyIcon.style.display = 'none';

      if (type === 'waiting') {
        if (textSpan) {
          textSpan.textContent = text || s.overlay.translating;
          textSpan.style.color = '#F1F1F1';
          textSpan.style.fontWeight = '500';
        }
        if (spinner) spinner.style.display = 'block';
        if (pulseRing) pulseRing.style.display = 'block';
        el.style.borderColor = '#383838';
        el.style.background = 'rgba(15, 15, 15, 0.88)';
        el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.5)';
      } else {
        if (textSpan) {
          textSpan.textContent = text || s.overlay.errorGeneric;
          textSpan.style.color = '#FCA5A5';
          textSpan.style.fontWeight = '500';
        }
        if (spinner) spinner.style.display = 'none';
        if (pulseRing) pulseRing.style.display = 'none';
        el.style.borderColor = '#ef4444';
        el.style.background = 'rgba(69, 10, 10, 0.88)';
        el.style.boxShadow = '0 4px 16px rgba(239, 68, 68, 0.35)';
      }

      el.style.display = 'inline-flex';
    }

    function hideOverlay() {
      if (overlayEl) {
        overlayEl.style.display = 'none';
      }
    }

    function highlightCancelButton() {
      const el = getOrCreateOverlay();
      if (!el) return;
      const cancelBtn = el.querySelector<HTMLButtonElement>('.vot-overlay-cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.background = '#ef4444';
        cancelBtn.style.color = '#FFFFFF';
        cancelBtn.style.borderColor = '#ef4444';
        cancelBtn.style.transform = 'scale(1.08)';
        setTimeout(() => {
          cancelBtn.style.background = '#272727';
          cancelBtn.style.color = '#AAAAAA';
          cancelBtn.style.borderColor = 'rgba(56, 56, 56, 0.8)';
          cancelBtn.style.transform = 'scale(1)';
        }, 600);
      }
    }
  }
});
