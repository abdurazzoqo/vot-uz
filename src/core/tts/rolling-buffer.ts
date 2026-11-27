import { TranslatedSentence } from '../text-source/types';

export interface SynthesizedSentence {
  id: string;
  start: number;
  end: number;
  uz: string;
  src_lang: string;
  audio?: Float32Array;
  sampleRate: number;
  durationSec: number;
  status: 'PENDING' | 'SYNTHESIZING' | 'READY' | 'DISCARDED';
}

export class RollingBuffer {
  private items: Map<string, SynthesizedSentence> = new Map();
  private coveredSpans: { start: number; end: number }[] = [];
  private horizonAheadSec: number;
  private keepBehindSec: number;
  private playheadSec: number = 0;

  constructor(options?: { horizonAheadSec?: number; keepBehindSec?: number }) {
    this.horizonAheadSec = options?.horizonAheadSec ?? 60; // 60s ahead
    this.keepBehindSec = options?.keepBehindSec ?? 120;     // keep 120s behind for instant seek/rewind
  }

  public makeId(start: number, end: number): string {
    return `${start.toFixed(2)}_${end.toFixed(2)}`;
  }

  public addSentences(sentences: TranslatedSentence[]): void {
    for (const s of sentences) {
      const id = this.makeId(s.start, s.end);
      if (this.items.has(id)) continue;

      // Overlap deduplication: reject competing / synonymous sentences covering the same time slot
      const hasOverlap = Array.from(this.items.values()).some(existing => {
        if (existing.status === 'DISCARDED') return false;
        const overlapStart = Math.max(existing.start, s.start);
        const overlapEnd = Math.min(existing.end, s.end);
        const overlapDur = overlapEnd - overlapStart;
        const minDur = Math.min(existing.end - existing.start, s.end - s.start);
        return Math.abs(existing.start - s.start) < 1.0 || (minDur > 0 && overlapDur / minDur > 0.4);
      });

      if (!hasOverlap) {
        this.items.set(id, {
          id,
          start: s.start,
          end: s.end,
          uz: s.uz,
          src_lang: s.src_lang,
          sampleRate: 24000,
          durationSec: 0,
          status: 'PENDING'
        });
      }
    }
    this.pruneOldAudio();
  }

  public updatePlayhead(playheadSec: number): SynthesizedSentence[] {
    this.playheadSec = playheadSec;
    this.pruneOldAudio();

    // Find pending items within the horizon
    const pendingInHorizon: SynthesizedSentence[] = [];
    for (const item of this.items.values()) {
      if (item.status === 'PENDING') {
        const dist = item.start - playheadSec;
        if (dist >= -1 && dist <= this.horizonAheadSec) {
          pendingInHorizon.push(item);
        }
      }
    }

    // Sort by distance ahead of playhead (nearest first)
    pendingInHorizon.sort((a, b) => a.start - b.start);
    return pendingInHorizon;
  }

  public onSeek(newPlayheadSec: number): void {
    this.playheadSec = newPlayheadSec;

    // Reset items that were synthesizing but are outside the new window
    for (const item of this.items.values()) {
      const dist = item.start - newPlayheadSec;
      if (dist < -this.keepBehindSec || dist > this.horizonAheadSec) {
        if (item.status === 'SYNTHESIZING') {
          item.status = 'PENDING';
        }
      }
    }

    this.pruneOldAudio();
  }

  public setAudio(id: string, audio: Float32Array, sampleRate: number): void {
    const item = this.items.get(id);
    if (item) {
      item.audio = audio;
      item.sampleRate = sampleRate;
      item.durationSec = audio.length / sampleRate;
      item.status = 'READY';
    }
  }

  public markSynthesizing(id: string): void {
    const item = this.items.get(id);
    if (item && item.status === 'PENDING') {
      item.status = 'SYNTHESIZING';
    }
  }

  public getItem(id: string): SynthesizedSentence | undefined {
    return this.items.get(id);
  }

  public getReadySentences(): SynthesizedSentence[] {
    return Array.from(this.items.values()).filter(i => i.status === 'READY');
  }

  public getReadyClipsFrom(fromSec: number): SynthesizedSentence[] {
    const ready: SynthesizedSentence[] = [];
    for (const item of this.items.values()) {
      if (item.status === 'READY' && item.audio && item.end > fromSec) {
        ready.push(item);
      }
    }
    ready.sort((a, b) => a.start - b.start);
    return ready;
  }

  public hasAudioFor(timeSec: number): boolean {
    for (const item of this.items.values()) {
      if (item.status === 'READY' && item.audio && item.start <= timeSec + 1.0 && item.end >= timeSec - 0.2) {
        return true;
      }
    }
    return false;
  }

  public hasPendingNear(timeSec: number, windowSec = 5.0): boolean {
    for (const item of this.items.values()) {
      if (item.status === 'PENDING' || item.status === 'SYNTHESIZING') {
        if (item.start >= timeSec - 1.0 && item.start <= timeSec + windowSec) {
          return true;
        }
      }
    }
    return false;
  }

  public isCoveredSilence(timeSec: number): boolean {
    const insideCovered = this.coveredSpans.some(span => timeSec >= span.start - 0.2 && timeSec <= span.end + 0.2);
    if (!insideCovered) return false;
    const hasItemNear = Array.from(this.items.values()).some(
      i => i.status !== 'DISCARDED' && i.start <= timeSec + 1.0 && i.end >= timeSec - 0.5
    );
    if (hasItemNear) return false;

    // Safeguard: If timeSec falls between two sentences separated by a gap > 4.0s,
    // this is not silence; it indicates an un-translated gap!
    const allItems = Array.from(this.items.values())
      .filter(i => i.status !== 'DISCARDED')
      .sort((a, b) => a.start - b.start);

    for (let idx = 0; idx < allItems.length - 1; idx++) {
      const prev = allItems[idx];
      const next = allItems[idx + 1];
      if (timeSec >= prev.end && timeSec <= next.start) {
        if (next.start - prev.end > 4.0) {
          return false;
        }
      }
    }

    return true;
  }

  public markWindowCovered(startSec: number, endSec: number): void {
    this.coveredSpans.push({ start: startSec, end: endSec });
    this.coveredSpans.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const span of this.coveredSpans) {
      if (merged.length === 0) {
        merged.push({ ...span });
      } else {
        const last = merged[merged.length - 1];
        if (span.start <= last.end + 1.0) {
          last.end = Math.max(last.end, span.end);
        } else {
          merged.push({ ...span });
        }
      }
    }
    this.coveredSpans = merged;
  }

  public computeReadyDurationAhead(fromSec: number, completedCoverageEnd: number = fromSec): number {
    const allItems = Array.from(this.items.values())
      .filter(i => i.end > fromSec && i.status !== 'DISCARDED')
      .sort((a, b) => a.start - b.start);

    // If there are no sentences at all:
    // Check if current position is covered by a completed window (silence/music)
    if (allItems.length === 0) {
      for (const span of this.coveredSpans) {
        if (fromSec >= span.start - 0.5 && fromSec < span.end) {
          return Math.max(0, span.end - fromSec);
        }
      }
      return 0;
    }

    // Must have at least one synthesized audio clip ahead to count as ready
    const hasAnyReadyAudio = allItems.some(i => i.status === 'READY' && i.audio);
    if (!hasAnyReadyAudio) {
      // Check if current position is within a covered silence span before the first sentence
      const firstItem = allItems[0];
      if (firstItem.start > fromSec + 2.0) {
        for (const span of this.coveredSpans) {
          if (fromSec >= span.start - 0.5 && span.end >= firstItem.start) {
            return firstItem.start - fromSec;
          }
        }
      }
      return 0;
    }

    let coverageEnd = fromSec;

    for (const item of allItems) {
      // Check if there is a gap between current coverageEnd and next item
      if (item.start > coverageEnd + 1.5) {
        const gapSpan = item.start - coverageEnd;
        const gapCovered = gapSpan <= 4.0 && this.coveredSpans.some(
          span => span.start <= coverageEnd + 0.5 && span.end >= item.start - 0.5
        );
        if (!gapCovered) {
          // Uncovered gap or gap > 4s: stop buffer coverage here!
          break;
        }
        coverageEnd = item.start;
      }

      if (item.status === 'READY' && item.audio) {
        if (item.end > coverageEnd) {
          coverageEnd = item.end;
        }
      } else {
        if (item.start > coverageEnd) {
          coverageEnd = item.start;
        }
        break;
      }
    }

    return Math.max(0, coverageEnd - fromSec);
  }

  /**
   * Frees memory by discarding AudioBuffers that are older than keepBehindSec behind playhead.
   */
  public pruneOldAudio(): void {
    const threshold = this.playheadSec - this.keepBehindSec;
    for (const item of this.items.values()) {
      if (item.end < threshold && item.status === 'READY') {
        item.audio = undefined; // release Float32Array to garbage collection
        item.status = 'DISCARDED';
      }
    }
  }

  public clear(): void {
    for (const item of this.items.values()) {
      item.audio = undefined;
    }
    this.items.clear();
    this.coveredSpans = [];
    this.playheadSec = 0;
  }

  public getCount(): { pending: number; ready: number; discarded: number } {
    let pending = 0, ready = 0, discarded = 0;
    for (const i of this.items.values()) {
      if (i.status === 'PENDING') pending++;
      else if (i.status === 'READY') ready++;
      else if (i.status === 'DISCARDED') discarded++;
    }
    return { pending, ready, discarded };
  }
}
