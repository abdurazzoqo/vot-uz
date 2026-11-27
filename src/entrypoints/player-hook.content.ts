import { defineContentScript } from 'wxt/utils/define-content-script';
import { PlayerButton } from '@/core/ui/player-button';
import { createPageBridgeMessage, isPageBridgeMessage } from '@/core/protocol/messages';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    console.log('[VOT-UZ PlayerHook] Injected into MAIN world at document_start');

    let currentVideoEl: HTMLVideoElement | null = null;
    let currentVideoId: string | null = null;
    let playerButton: PlayerButton | null = null;
    let originalVolumeBeforeDucking = 1.0;
    let isDucked = false;

    // 1. Hook MediaSource for audio capture
    hookMediaSource();

    // 2. Setup player button
    playerButton = new PlayerButton({
      onToggle: (enabled) => {
        window.postMessage(createPageBridgeMessage('TOGGLE_DUBBING', { enabled }), '*');
      }
    });

    // 3. Monitor YouTube video & player controls
    const observer = new MutationObserver(() => {
      attachVideoListeners();
      if (playerButton && !playerButton.isMounted()) {
        playerButton.mount();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Handle SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      console.log('[VOT-UZ PlayerHook] yt-navigate-finish detected');
      attachVideoListeners(true);
      if (playerButton && !playerButton.isMounted()) {
        playerButton.mount();
      }
    });

    function attachVideoListeners(forceNotify = false) {
      const video = document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
      if (!video) return;

      const videoId = extractVideoId();
      if (!videoId) return;

      const isNew = video !== currentVideoEl || videoId !== currentVideoId || forceNotify;

      if (isNew) {
        currentVideoEl = video;
        currentVideoId = videoId;
        originalVolumeBeforeDucking = video.volume || 1.0;

        console.log(`[VOT-UZ PlayerHook] Broadcasting VIDEO_DETECTED for ${videoId}`);
        window.postMessage(createPageBridgeMessage('VIDEO_DETECTED', {
          videoId,
          currentTime: video.currentTime,
          duration: video.duration || 0
        }), '*');

        const onDurationChange = () => {
          if (video.duration && !isNaN(video.duration) && video.duration > 0) {
            window.postMessage(createPageBridgeMessage('VIDEO_DETECTED', {
              videoId,
              currentTime: video.currentTime,
              duration: video.duration
            }), '*');
          }
        };

        video.addEventListener('loadedmetadata', onDurationChange, { once: true });
        video.addEventListener('durationchange', onDurationChange);

        video.addEventListener('play', () => {
          checkAdState();
          if (isDucked && currentVideoEl) {
            currentVideoEl.volume = targetDuckVolume;
            const player = document.getElementById('movie_player') as any;
            if (player && typeof player.setVolume === 'function') {
              player.setVolume(Math.round(targetDuckVolume * 100));
            }
          }
          window.postMessage(createPageBridgeMessage('PLAYER_PLAY', { currentTime: video.currentTime }), '*');
        });

        video.addEventListener('pause', () => {
          checkAdState();
          window.postMessage(createPageBridgeMessage('PLAYER_PAUSE', { currentTime: video.currentTime }), '*');
        });

        video.addEventListener('seeking', () => {
          window.postMessage(createPageBridgeMessage('PLAYER_SEEKING', { currentTime: video.currentTime }), '*');
        });

        video.addEventListener('seeked', () => {
          window.postMessage(createPageBridgeMessage('PLAYER_SEEKED', { currentTime: video.currentTime }), '*');
        });

        video.addEventListener('timeupdate', () => {
          checkAdState();
        });

        video.addEventListener('volumechange', () => {
          if (isDucked && !isAnimatingVolume && currentVideoEl) {
            if (Math.abs(currentVideoEl.volume - targetDuckVolume) > 0.02) {
              currentVideoEl.volume = targetDuckVolume;
            }
            const player = document.getElementById('movie_player') as any;
            if (player && typeof player.getVolume === 'function' && typeof player.setVolume === 'function') {
              const expected = Math.round(targetDuckVolume * 100);
              if (Math.abs(player.getVolume() - expected) > 2) {
                player.setVolume(expected);
              }
            }
          }
        });
      }
    }

    // Continuous volume watchdog to prevent YouTube player scripts from overriding ducked audio
    setInterval(() => {
      if (isDucked && !isAnimatingVolume && currentVideoEl) {
        if (Math.abs(currentVideoEl.volume - targetDuckVolume) > 0.02) {
          currentVideoEl.volume = targetDuckVolume;
        }
        const player = document.getElementById('movie_player') as any;
        if (player && typeof player.getVolume === 'function' && typeof player.setVolume === 'function') {
          const expected = Math.round(targetDuckVolume * 100);
          if (Math.abs(player.getVolume() - expected) > 2) {
            player.setVolume(expected);
          }
        }
      }
    }, 100);

    let lastAdState = false;
    function checkAdState() {
      const playerEl = document.getElementById('movie_player');
      const isAd = playerEl ? (playerEl.classList.contains('ad-showing') || playerEl.classList.contains('ad-interrupting')) : false;
      if (isAd !== lastAdState) {
        lastAdState = isAd;
        window.postMessage(createPageBridgeMessage('AD_STATE_CHANGE', { isAd }), '*');
      }
    }

    function extractVideoId(): string | null {
      const url = new URL(window.location.href);
      return url.searchParams.get('v');
    }

    // Hook MediaSource audio buffers
    function hookMediaSource() {
      const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function (type: string) {
        const sb = origAddSourceBuffer.call(this, type);
        if (type && type.includes('audio')) {
          console.log('[VOT-UZ PlayerHook] Intercepted audio SourceBuffer:', type);
        }
        return sb;
      };
    }

    // Listen for effect executions from Isolated world
    window.addEventListener('message', (event) => {
      if (!isPageBridgeMessage(event.data)) return;

      const { type, payload } = event.data;
      if (type === 'EXECUTE_EFFECT') {
        const effect = payload?.effect;
        if (!effect || !currentVideoEl) return;

        switch (effect.type) {
          case 'PAUSE_VIDEO':
            if (!currentVideoEl.paused) {
              currentVideoEl.pause();
            }
            break;
          case 'RESUME_VIDEO':
            if (currentVideoEl.paused) {
              currentVideoEl.play().catch(() => {});
            }
            break;
          case 'MUTE_VIDEO':
            currentVideoEl.muted = true;
            break;
          case 'UNMUTE_VIDEO':
            currentVideoEl.muted = false;
            break;
          case 'SET_DUCKING':
            applyDucking(effect.ducked, payload?.duckLevel ?? 0.15);
            break;
        }
      } else if (type === 'SET_DUCKING') {
        applyDucking(payload?.duck ?? false, payload?.duckLevel ?? 0.15);
      } else if (type === 'ADJUST_VIDEO_RATE') {
        if (currentVideoEl && typeof payload?.rate === 'number') {
          currentVideoEl.playbackRate = payload.rate;
        }
      } else if (type === 'STATE_UPDATE') {
        if (playerButton) {
          playerButton.setState(
            payload?.active ?? false,
            payload?.preparing ?? false,
            payload?.tooltip
          );
        }
      } else if (type === 'REQUEST_VIDEO_STATUS') {
        attachVideoListeners(true);
      }
    });

    let duckAnimFrameId: number | null = null;
    let isAnimatingVolume = false;
    let targetDuckVolume = 0.15;

    function applyDucking(duck: boolean, duckLevel: number) {
      if (!currentVideoEl) return;

      if (duckAnimFrameId !== null) {
        cancelAnimationFrame(duckAnimFrameId);
        duckAnimFrameId = null;
      }

      const player = document.getElementById('movie_player') as any;

      if (duck) {
        if (!isDucked) {
          originalVolumeBeforeDucking = currentVideoEl.volume > 0.05 ? currentVideoEl.volume : 1.0;
          isDucked = true;
        }
        targetDuckVolume = Math.max(0, Math.min(1, originalVolumeBeforeDucking * duckLevel));
        currentVideoEl.volume = targetDuckVolume;
        if (player && typeof player.setVolume === 'function') {
          player.setVolume(Math.round(targetDuckVolume * 100));
        }
      } else {
        if (isDucked) {
          const targetVol = originalVolumeBeforeDucking;
          isDucked = false;
          currentVideoEl.volume = targetVol;
          if (player && typeof player.setVolume === 'function') {
            player.setVolume(Math.round(targetVol * 100));
          }
        }
      }
    }

    function animateVolume(start: number, target: number, durationMs: number, onComplete?: () => void) {
      if (!currentVideoEl) return;
      if (durationMs <= 0 || Math.abs(start - target) < 0.01) {
        currentVideoEl.volume = target;
        onComplete?.();
        return;
      }

      isAnimatingVolume = true;
      const startTime = performance.now();
      const step = (now: number) => {
        if (!currentVideoEl) {
          isAnimatingVolume = false;
          return;
        }
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        currentVideoEl.volume = start + (target - start) * progress;

        if (progress < 1) {
          duckAnimFrameId = requestAnimationFrame(step);
        } else {
          duckAnimFrameId = null;
          isAnimatingVolume = false;
          onComplete?.();
        }
      };
      duckAnimFrameId = requestAnimationFrame(step);
    }
  }
});
