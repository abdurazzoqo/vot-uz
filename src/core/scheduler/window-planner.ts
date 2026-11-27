import { TranslatedSentence } from '../text-source/types';

export interface TimeWindow {
  index: number;
  startSec: number;
  endSec: number;
  duration: number;
}

export const DEFAULT_WINDOW_SIZES = [25, 30, 35, 35, 35];

export class WindowPlanner {
  private windowSizes: number[];

  constructor(sizes: number[] = DEFAULT_WINDOW_SIZES) {
    this.windowSizes = sizes.length > 0 ? sizes : DEFAULT_WINDOW_SIZES;
  }

  /**
   * Plans a sequence of windows starting from current position up to maxDuration or prefetchHorizon.
   */
  public planWindows(startPosition: number, totalDuration: number, maxHorizonSeconds = 600): TimeWindow[] {
    const windows: TimeWindow[] = [];
    let current = Math.max(0, startPosition);
    const hasKnownDuration = typeof totalDuration === 'number' && !isNaN(totalDuration) && isFinite(totalDuration) && totalDuration > 0;
    const effectiveDuration = hasKnownDuration ? totalDuration : startPosition + maxHorizonSeconds;

    if (current >= effectiveDuration) {
      return [];
    }

    const horizonEnd = Math.min(effectiveDuration, startPosition + maxHorizonSeconds);

    let idx = 0;
    while (current < horizonEnd) {
      const sizeIndex = Math.min(idx, this.windowSizes.length - 1);
      const size = this.windowSizes[sizeIndex];
      const end = Math.min(horizonEnd, current + size);

      if (end <= current) break;

      windows.push({
        index: idx,
        startSec: Number(current.toFixed(2)),
        endSec: Number(end.toFixed(2)),
        duration: Number((end - current).toFixed(2))
      });

      current = end;
      idx++;
    }

    return windows;
  }

  /**
   * Assigns sentences to windows based on their start timestamp:
   * A sentence belongs strictly to the window where window.startSec <= sentence.start < window.endSec.
   */
  public assignSentencesToWindow(
    sentences: TranslatedSentence[],
    window: TimeWindow
  ): TranslatedSentence[] {
    return sentences.filter(s => s.start >= window.startSec && s.start < window.endSec);
  }

  /**
   * Merges and deduplicates sentences by timestamp and text.
   */
  public dedupeSentences(sentences: TranslatedSentence[]): TranslatedSentence[] {
    const sorted = [...sentences].sort((a, b) => a.start - b.start);
    const result: TranslatedSentence[] = [];

    for (const s of sorted) {
      const isDuplicate = result.some(existing => {
        // 1. Identical text close in time
        if (Math.abs(existing.start - s.start) < 0.8 && existing.uz === s.uz) {
          return true;
        }
        // 2. Synonymous overlap: if two sentences start within 1.0s of each other,
        // or their time spans overlap by > 40%, they are competing translations of the same speech.
        const overlapStart = Math.max(existing.start, s.start);
        const overlapEnd = Math.min(existing.end, s.end);
        const overlapDur = overlapEnd - overlapStart;
        const minDur = Math.min(existing.end - existing.start, s.end - s.start);

        if (Math.abs(existing.start - s.start) < 1.0) {
          return true;
        }
        if (minDur > 0 && overlapDur / minDur > 0.4) {
          return true;
        }
        return false;
      });

      if (!isDuplicate) {
        result.push(s);
      }
    }

    return result;
  }
}
