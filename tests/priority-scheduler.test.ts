import { describe, it, expect, vi } from 'vitest';
import { PriorityScheduler, SimulatedClock } from '@/core/scheduler/priority-scheduler';
import { TextSource, TextSourceResult, WindowRequestOptions } from '@/core/text-source/types';
import { TimeWindow } from '@/core/scheduler/window-planner';

class MockTextSource implements TextSource {
  public delayMs: number = 100;
  public calls: WindowRequestOptions[] = [];

  public async fetchWindow(options: WindowRequestOptions): Promise<TextSourceResult> {
    this.calls.push(options);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          sentences: [
            { start: options.startSec, end: options.endSec, uz: `Uzbek for [${options.startSec}-${options.endSec}]`, src_lang: 'en' }
          ],
          sourceUsed: 'SOURCE_A',
          latencyMs: this.delayMs
        });
      }, this.delayMs);

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        });
      }
    });
  }
}

describe('PriorityScheduler with Simulated Clock', () => {
  it('respects concurrency limit of 2 concurrent requests', async () => {
    const mockSource = new MockTextSource();
    mockSource.delayMs = 50;

    const completedWindows: TimeWindow[] = [];
    const scheduler = new PriorityScheduler({
      textSource: mockSource,
      maxConcurrency: 2,
      prefetchLimitSeconds: 600,
      callbacks: {
        onWindowSuccess: (w) => completedWindows.push(w),
        onWindowError: () => {}
      }
    });

    scheduler.initSession('vid_123', 'fake_key', 0);

    const windows: TimeWindow[] = [
      { index: 0, startSec: 0, endSec: 25, duration: 25 },
      { index: 1, startSec: 25, endSec: 70, duration: 45 },
      { index: 2, startSec: 70, endSec: 160, duration: 90 },
      { index: 3, startSec: 160, endSec: 340, duration: 180 }
    ];

    scheduler.enqueueWindows(windows);

    // Immediately after enqueue: only 2 should be running!
    expect(scheduler.getActiveCount()).toBe(2);
    expect(mockSource.calls.length).toBe(2);

    // Wait for the first two to complete
    await new Promise(r => setTimeout(r, 60));

    // Next two should have been pumped
    expect(completedWindows.length).toBe(2);
    expect(scheduler.getActiveCount()).toBe(2);

    await new Promise(r => setTimeout(r, 60));
    expect(completedWindows.length).toBe(4);
    expect(scheduler.getActiveCount()).toBe(0);
  });

  it('orders priority by distance to playhead', async () => {
    const mockSource = new MockTextSource();
    mockSource.delayMs = 10;

    const completedWindows: TimeWindow[] = [];
    const scheduler = new PriorityScheduler({
      textSource: mockSource,
      maxConcurrency: 1, // serial for deterministic check
      prefetchLimitSeconds: 600,
      callbacks: {
        onWindowSuccess: (w) => completedWindows.push(w),
        onWindowError: () => {}
      }
    });

    // Playhead is at second 50
    scheduler.initSession('vid_123', 'fake_key', 50);

    // Enqueue window far in future first, then window near playhead
    const winFar = { index: 2, startSec: 120, endSec: 180, duration: 60 };
    const winNear = { index: 1, startSec: 50, endSec: 90, duration: 40 };

    scheduler.enqueueWindows([winFar, winNear]);

    // Near playhead (50s) should be fetched first
    await new Promise(r => setTimeout(r, 15));
    expect(completedWindows[0].startSec).toBe(50);

    await new Promise(r => setTimeout(r, 15));
    expect(completedWindows[1].startSec).toBe(120);
  });

  it('aborts out-of-horizon in-flight requests on seek', async () => {
    const mockSource = new MockTextSource();
    mockSource.delayMs = 200; // longer delay to test in-flight cancellation

    let abortedCount = 0;
    const scheduler = new PriorityScheduler({
      textSource: mockSource,
      maxConcurrency: 2,
      prefetchLimitSeconds: 100,
      callbacks: {
        onWindowSuccess: () => {},
        onWindowError: (w, err) => {
          if (err.message === 'Aborted') abortedCount++;
        }
      }
    });

    scheduler.initSession('vid_123', 'fake_key', 0);
    const win1 = { index: 0, startSec: 0, endSec: 25, duration: 25 };
    scheduler.enqueueWindows([win1]);

    expect(scheduler.getActiveCount()).toBe(1);

    // User seeks far away to 500s
    const winSeek = [{ index: 0, startSec: 500, endSec: 525, duration: 25 }];
    scheduler.onSeek(500, winSeek);

    // Original task at 0s was outside new horizon and should be aborted
    await new Promise(r => setTimeout(r, 20));
    expect(mockSource.calls[0].signal?.aborted).toBe(true);
  });

  it('allows re-enqueuing cancelled windows on backward seek', async () => {
    const mockSource = new MockTextSource();
    mockSource.delayMs = 10;

    const completed: TimeWindow[] = [];
    const scheduler = new PriorityScheduler({
      textSource: mockSource,
      maxConcurrency: 1,
      prefetchLimitSeconds: 50,
      callbacks: {
        onWindowSuccess: (w) => completed.push(w),
        onWindowError: () => {}
      }
    });

    scheduler.initSession('vid_123', 'fake_key', 0);
    const win1 = { index: 0, startSec: 0, endSec: 25, duration: 25 };
    scheduler.enqueueWindows([win1]);

    // Seek far away before win1 completes
    scheduler.onSeek(200, [{ index: 0, startSec: 200, endSec: 225, duration: 25 }]);
    await new Promise(r => setTimeout(r, 15));

    // Seek back to 0s
    scheduler.onSeek(0, [win1]);
    await new Promise(r => setTimeout(r, 20));

    expect(completed.some(w => w.startSec === 0)).toBe(true);
  });
});
