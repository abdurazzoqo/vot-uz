import { TimeWindow } from './window-planner';
import { TranslatedSentence, TextSource, WindowRequestOptions } from '../text-source/types';

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): any;
  clearTimeout(id: any): void;
}

export const RealClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id)
};

export class SimulatedClock implements Clock {
  private currentTime: number = 0;
  private timers: { id: number; time: number; callback: () => void }[] = [];
  private nextId = 1;

  public now(): number {
    return this.currentTime;
  }

  public setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, time: this.currentTime + ms, callback });
    this.timers.sort((a, b) => a.time - b.time);
    return id;
  }

  public clearTimeout(id: number): void {
    this.timers = this.timers.filter(t => t.id !== id);
  }

  public tick(ms: number): void {
    const targetTime = this.currentTime + ms;
    while (this.timers.length > 0 && this.timers[0].time <= targetTime) {
      const nextTimer = this.timers.shift()!;
      this.currentTime = nextTimer.time;
      nextTimer.callback();
    }
    this.currentTime = targetTime;
  }
}

export interface ScheduledTask {
  window: TimeWindow;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  priority: number;
  abortController?: AbortController;
  retries: number;
}

export interface SchedulerCallbacks {
  onWindowSuccess: (window: TimeWindow, sentences: TranslatedSentence[], sourceUsed: string, latencyMs: number) => void;
  onWindowError: (window: TimeWindow, error: Error) => void;
}

export class PriorityScheduler {
  private queue: ScheduledTask[] = [];
  private activeCount: number = 0;
  private maxConcurrency: number;
  private prefetchLimitSeconds: number;
  private playheadSec: number = 0;
  private videoId: string = '';
  private apiKey: string = '';
  private textSource: TextSource;
  private clock: Clock;
  private callbacks: SchedulerCallbacks;
  private maxCoveredEndSec: number = 0;

  constructor(options: {
    textSource: TextSource;
    maxConcurrency?: number;
    prefetchLimitSeconds?: number;
    clock?: Clock;
    callbacks: SchedulerCallbacks;
  }) {
    this.textSource = options.textSource;
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.prefetchLimitSeconds = options.prefetchLimitSeconds ?? 600;
    this.clock = options.clock ?? RealClock;
    this.callbacks = options.callbacks;
  }

  public initSession(videoId: string, apiKey: string, initialPlayheadSec: number = 0) {
    this.cancelAll();
    this.videoId = videoId;
    this.apiKey = apiKey;
    this.playheadSec = initialPlayheadSec;
    this.maxCoveredEndSec = 0;
  }

  public enqueueWindows(windows: TimeWindow[]) {
    for (const w of windows) {
      this.maxCoveredEndSec = Math.max(this.maxCoveredEndSec, w.endSec);
      // Remove any cancelled or failed task for this window so it can be retried fresh
      this.queue = this.queue.filter(t => !(t.window.startSec === w.startSec && t.window.endSec === w.endSec && (t.status === 'CANCELLED' || t.status === 'FAILED')));

      const exists = this.queue.some(t => t.window.startSec === w.startSec && t.window.endSec === w.endSec);
      if (!exists) {
        this.queue.push({
          window: w,
          status: 'PENDING',
          priority: this.computePriority(w.startSec),
          retries: 0
        });
      }
    }
    this.sortQueue();
    this.pump();
  }

  public updatePlayhead(newPlayheadSec: number) {
    this.playheadSec = newPlayheadSec;
    this.sortQueue();
    this.pump();
  }

  public onSeek(newPlayheadSec: number, newWindows: TimeWindow[]) {
    this.playheadSec = newPlayheadSec;

    // Abort active tasks that are outside the immediate new horizon
    for (const task of this.queue) {
      if (task.status === 'RUNNING' && task.abortController) {
        const dist = task.window.startSec - newPlayheadSec;
        if (dist < -5 || dist > this.prefetchLimitSeconds) {
          task.abortController.abort();
          task.status = 'CANCELLED';
        }
      }
    }

    // Remove pending tasks that are far away
    this.queue = this.queue.filter(t => t.status === 'RUNNING' || t.status === 'COMPLETED');

    // Enqueue newly planned windows starting at seek position
    this.enqueueWindows(newWindows);
  }

  public cancelAll() {
    for (const task of this.queue) {
      if (task.status === 'RUNNING' && task.abortController) {
        task.abortController.abort();
        task.status = 'CANCELLED';
      }
    }
    this.queue = [];
    this.activeCount = 0;
  }

  public getQueueLength(): number {
    return this.queue.filter(t => t.status === 'PENDING').length;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getFurthestEnd(): number {
    const queueMax = this.queue.reduce((max, t) => Math.max(max, t.window.endSec), 0);
    return Math.max(this.maxCoveredEndSec, queueMax);
  }

  private computePriority(windowStartSec: number): number {
    const diff = windowStartSec - this.playheadSec;
    if (diff >= 0) {
      // Future window: closest to playhead has highest priority (lower number = earlier in queue)
      return diff;
    } else {
      // Past window: lower priority
      return 100000 + Math.abs(diff);
    }
  }

  private sortQueue() {
    for (const t of this.queue) {
      if (t.status === 'PENDING') {
        t.priority = this.computePriority(t.window.startSec);
      }
    }
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  private pump() {
    if (this.activeCount >= this.maxConcurrency) return;
    if (!this.apiKey || !this.videoId) return;

    const nextTask = this.queue.find(t => t.status === 'PENDING');
    if (!nextTask) return;

    // Check prefetch limit
    const distanceAhead = nextTask.window.startSec - this.playheadSec;
    if (distanceAhead > this.prefetchLimitSeconds) {
      return; // Do not fetch beyond prefetch limit
    }

    nextTask.status = 'RUNNING';
    nextTask.abortController = new AbortController();
    this.activeCount++;

    const options: WindowRequestOptions = {
      videoId: this.videoId,
      apiKey: this.apiKey,
      startSec: nextTask.window.startSec,
      endSec: nextTask.window.endSec,
      signal: nextTask.abortController.signal
    };

    this.textSource.fetchWindow(options)
      .then(res => {
        if (nextTask.status === 'CANCELLED') return;
        nextTask.status = 'COMPLETED';
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.callbacks.onWindowSuccess(nextTask.window, res.sentences, res.sourceUsed, res.latencyMs);
        this.pump();
      })
      .catch(err => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        const isAbort = err.name === 'AbortError' || err.message === 'Aborted' || err.message?.toLowerCase().includes('abort');
        if (isAbort || nextTask.status === 'CANCELLED') {
          nextTask.status = 'CANCELLED';
        } else {
          nextTask.status = 'FAILED';
          nextTask.retries++;
          this.callbacks.onWindowError(nextTask.window, err);
        }
        this.pump();
      });

    // Try pumping more up to maxConcurrency
    this.pump();
  }
}
