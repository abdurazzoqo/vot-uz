import { TranslatedSentence } from '../text-source/types';

export interface CachedWindowEntry {
  key: string;            // videoId_start_end
  videoId: string;
  startSec: number;
  endSec: number;
  sentences: TranslatedSentence[];
  createdAt: number;
  lastAccessedAt: number;
}

const DB_NAME = 'vot_uz_cache_db';
const STORE_NAME = 'windows';
const DB_VERSION = 1;
const MAX_CACHE_ENTRIES = 200;

export class TranslationCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof indexedDB !== 'undefined') {
      this.initDb();
    }
  }

  private initDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('by_video', 'videoId', { unique: false });
            store.createIndex('by_access', 'lastAccessedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private makeKey(videoId: string, startSec: number, endSec: number): string {
    return `${videoId}_${startSec.toFixed(1)}_${endSec.toFixed(1)}`;
  }

  public async get(videoId: string, startSec: number, endSec: number): Promise<TranslatedSentence[] | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await this.initDb();
      const key = this.makeKey(videoId, startSec, endSec);

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
          const entry = req.result as CachedWindowEntry | undefined;
          if (entry) {
            // Update lastAccessedAt for LRU
            entry.lastAccessedAt = Date.now();
            store.put(entry);
            resolve(entry.sentences);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async set(videoId: string, startSec: number, endSec: number, sentences: TranslatedSentence[]): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await this.initDb();
      const key = this.makeKey(videoId, startSec, endSec);

      const entry: CachedWindowEntry = {
        key,
        videoId,
        startSec,
        endSec,
        sentences,
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(entry);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // Periodic LRU cleanup if size exceeds MAX_CACHE_ENTRIES
      this.evictOldEntriesIfNeeded(db);
    } catch (e) {
      console.warn('[VOT-UZ Cache] Failed to write cache entry:', e);
    }
  }

  private async evictOldEntriesIfNeeded(db: IDBDatabase): Promise<void> {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();

      countReq.onsuccess = () => {
        if (countReq.result > MAX_CACHE_ENTRIES) {
          const index = store.index('by_access');
          const cursorReq = index.openCursor(); // Oldest first
          let toDelete = countReq.result - MAX_CACHE_ENTRIES;

          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && toDelete > 0) {
              cursor.delete();
              toDelete--;
              cursor.continue();
            }
          };
        }
      };
    } catch {}
  }

  public async clearForVideo(videoId: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await this.initDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_video');
      const req = index.openCursor(IDBKeyRange.only(videoId));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    } catch {}
  }
}
