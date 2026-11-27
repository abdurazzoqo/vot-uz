export interface DebugStats {
  fsmState: string;
  sessionId: string;
  textSource: string;
  timeToFirstAudioMs: number | null;
  lastWindowLatencyMs: number | null;
  ttsSpeedFactor: number | null;
  queueSize: number;
  translatedRange: string;
  cacheHits: number;
  dailyRequests: number;
  sentences: Array<{
    text: string;
    targetStart: number;
    realStart: number;
    lag: number;
  }>;
  avgLag: number;
}

export class DebugOverlay {
  private containerEl: HTMLElement | null = null;
  private isVisible: boolean = false;
  private stats: DebugStats = {
    fsmState: 'idle',
    sessionId: '',
    textSource: 'SOURCE_A',
    timeToFirstAudioMs: null,
    lastWindowLatencyMs: null,
    ttsSpeedFactor: null,
    queueSize: 0,
    translatedRange: '0.0s - 0.0s',
    cacheHits: 0,
    dailyRequests: 0,
    sentences: [],
    avgLag: 0
  };

  public mount(): void {
    if (this.containerEl && document.contains(this.containerEl)) return;

    const player = document.getElementById('movie_player');
    if (!player) return;

    const el = document.createElement('div');
    el.id = 'vot-debug-overlay';
    el.style.position = 'absolute';
    el.style.top = '50px';
    el.style.left = '16px';
    el.style.zIndex = '65';
    el.style.maxWidth = '340px';
    el.style.padding = '10px 12px';
    el.style.background = 'rgba(15, 23, 42, 0.9)';
    el.style.backdropFilter = 'blur(10px)';
    el.style.borderRadius = '8px';
    el.style.border = '1px solid rgba(56, 189, 248, 0.3)';
    el.style.color = '#38bdf8';
    el.style.fontFamily = 'Consolas, Monaco, monospace';
    el.style.fontSize = '11px';
    el.style.lineHeight = '1.4';
    el.style.pointerEvents = 'none';
    el.style.display = this.isVisible ? 'block' : 'none';
    el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';

    player.appendChild(el);
    this.containerEl = el;
    this.render();
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    if (this.containerEl) {
      this.containerEl.style.display = visible ? 'block' : 'none';
    }
  }

  public update(partial: Partial<DebugStats>) {
    this.stats = { ...this.stats, ...partial };
    this.render();
  }

  public addSentenceTiming(text: string, targetStart: number, realStart: number) {
    const lag = realStart - targetStart;
    this.stats.sentences.push({ text, targetStart, realStart, lag });
    if (this.stats.sentences.length > 5) {
      this.stats.sentences.shift();
    }
    const allLags = this.stats.sentences.map(s => s.lag);
    this.stats.avgLag = allLags.reduce((a, b) => a + b, 0) / allLags.length;
    this.render();
  }

  public addSentence(text: string, targetStart: number, lag: number) {
    this.addSentenceTiming(text, targetStart, targetStart + lag);
  }

  private render() {
    if (!this.containerEl) return;

    // Clear existing children safely
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }

    const s = this.stats;
    const firstAudioStr = s.timeToFirstAudioMs !== null ? `${(s.timeToFirstAudioMs / 1000).toFixed(2)}s` : '--';
    const winLatStr = s.lastWindowLatencyMs !== null ? `${(s.lastWindowLatencyMs / 1000).toFixed(2)}s` : '--';
    const ttsSpeedStr = s.ttsSpeedFactor !== null ? `${s.ttsSpeedFactor.toFixed(2)}x` : '--';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px; margin-bottom: 4px; font-weight: bold;';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'VOT DEBUG MONITOR';
    const stateSpan = document.createElement('span');
    stateSpan.style.color = '#4ade80';
    stateSpan.textContent = s.fsmState.toUpperCase();
    headerRow.appendChild(titleSpan);
    headerRow.appendChild(stateSpan);
    this.containerEl.appendChild(headerRow);

    const addRow = (label: string, value: string, valColor?: string) => {
      const row = document.createElement('div');
      row.textContent = label + ': ';
      const span = document.createElement('span');
      span.textContent = value;
      if (valColor) span.style.color = valColor;
      row.appendChild(span);
      this.containerEl?.appendChild(row);
    };

    addRow('Session', s.sessionId.slice(-10), '#f1f5f9');
    addRow('Source', `${s.textSource} | Queue: ${s.queueSize}`, '#fbbf24');
    addRow('First audio', `${firstAudioStr} | Latency: ${winLatStr}`);
    addRow('TTS speed', `${ttsSpeedStr} | Cache hits: ${s.cacheHits}`);
    addRow('Range', s.translatedRange);
    addRow('Avg lag', `${s.avgLag.toFixed(2)}s | Req today: ${s.dailyRequests}`, Math.abs(s.avgLag) > 1.0 ? '#f87171' : '#4ade80');

    if (s.sentences.length > 0) {
      const sentContainer = document.createElement('div');
      sentContainer.style.cssText = 'margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;';
      const sentHeader = document.createElement('div');
      sentHeader.style.cssText = 'color: #94a3b8; font-weight: bold;';
      sentHeader.textContent = 'Recent sentences:';
      sentContainer.appendChild(sentHeader);

      for (const st of s.sentences) {
        const item = document.createElement('div');
        item.style.cssText = 'font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        item.style.color = Math.abs(st.lag) > 1.5 ? '#f87171' : '#e2e8f0';
        item.textContent = `[${st.targetStart.toFixed(1)}s] lag: ${st.lag >= 0 ? '+' : ''}${st.lag.toFixed(2)}s | "${st.text.slice(0, 24)}..."`;
        sentContainer.appendChild(item);
      }
      this.containerEl.appendChild(sentContainer);
    }
  }
}
