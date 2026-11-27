import { describe, it, expect } from 'vitest';
import { WindowPlanner } from '@/core/scheduler/window-planner';
import { TranslatedSentence } from '@/core/text-source/types';

describe('WindowPlanner', () => {
  const planner = new WindowPlanner([25, 45, 90, 180, 300]);

  it('plans progressive windows from start position', () => {
    const windows = planner.planWindows(0, 600, 600);
    expect(windows.length).toBeGreaterThan(3);
    expect(windows[0]).toEqual({
      index: 0,
      startSec: 0,
      endSec: 25,
      duration: 25
    });
    expect(windows[1]).toEqual({
      index: 1,
      startSec: 25,
      endSec: 70, // 25 + 45
      duration: 45
    });
    expect(windows[2]).toEqual({
      index: 2,
      startSec: 70,
      endSec: 160, // 70 + 90
      duration: 90
    });
  });

  it('clamps to total video duration', () => {
    const shortWindows = planner.planWindows(0, 30, 600);
    expect(shortWindows.length).toBe(2);
    expect(shortWindows[0].endSec).toBe(25);
    expect(shortWindows[1].endSec).toBe(30);
  });

  it('falls back to maxHorizon when duration is 0, NaN or negative', () => {
    const windows0 = planner.planWindows(0, 0, 600);
    expect(windows0.length).toBeGreaterThan(0);
    expect(windows0[windows0.length - 1].endSec).toBe(600);

    const windowsNaN = planner.planWindows(0, NaN, 300);
    expect(windowsNaN.length).toBeGreaterThan(0);
    expect(windowsNaN[windowsNaN.length - 1].endSec).toBe(300);

    const windowsNeg = planner.planWindows(10, -1, 100);
    expect(windowsNeg.length).toBeGreaterThan(0);
    expect(windowsNeg[windowsNeg.length - 1].endSec).toBe(110);
  });

  it('assigns sentences to the window where they start', () => {
    const sentences: TranslatedSentence[] = [
      { start: 5, end: 10, uz: 'Gap 1', src_lang: 'en' },
      { start: 24.5, end: 27, uz: 'Gap 2', src_lang: 'en' }, // starts in window 0
      { start: 25.1, end: 30, uz: 'Gap 3', src_lang: 'en' }  // starts in window 1
    ];

    const win0 = { index: 0, startSec: 0, endSec: 25, duration: 25 };
    const win1 = { index: 1, startSec: 25, endSec: 70, duration: 45 };

    const inWin0 = planner.assignSentencesToWindow(sentences, win0);
    const inWin1 = planner.assignSentencesToWindow(sentences, win1);

    expect(inWin0.map(s => s.uz)).toEqual(['Gap 1', 'Gap 2']);
    expect(inWin1.map(s => s.uz)).toEqual(['Gap 3']);
  });

  it('deduplicates synonymous sentences covering the same time slot', () => {
    const sentences: TranslatedSentence[] = [
      { start: 10.0, end: 14.0, uz: 'Bu juda ajoyib usul', src_lang: 'en' },
      { start: 10.4, end: 14.2, uz: 'Bu juda zo\'r metod', src_lang: 'en' }, // competing synonym translation
      { start: 15.0, end: 18.0, uz: 'Keyingi fikr', src_lang: 'en' }
    ];

    const deduped = planner.dedupeSentences(sentences);
    expect(deduped.length).toBe(2);
    expect(deduped[0].uz).toBe('Bu juda ajoyib usul');
    expect(deduped[1].uz).toBe('Keyingi fikr');
  });

  it('plans valid windows when start position is within horizon', () => {
    const windows = planner.planWindows(835.7, 1185, 600);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].startSec).toBe(835.7);
    expect(windows[0].endSec).toBe(860.7); // 835.7 + 25s
    expect(windows[windows.length - 1].endSec).toBeLessThanOrEqual(1185);
  });

  it('returns empty array when seeking past video duration', () => {
    const windows = planner.planWindows(1200, 1185, 600);
    expect(windows).toEqual([]);
  });
});
