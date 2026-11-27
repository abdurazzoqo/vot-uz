const CACHE_NAME = 'vot_uz_gapiring_model_cache_v2';

export interface DownloadProgress {
  file: string;
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Ensures model files from HuggingFace are downloaded only once and cached in Cache API.
 */
export class ModelCacheManager {
  private cachePromise: Promise<Cache> | null = null;

  private getCache(): Promise<Cache> {
    if (!this.cachePromise) {
      this.cachePromise = caches.open(CACHE_NAME);
    }
    return this.cachePromise;
  }

  /**
   * Checks if main model files are already cached.
   */
  public async isModelCached(): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    try {
      const cache = await this.getCache();
      const match = await cache.match('https://huggingface.co/islomov/gapi-uz-gapiring-v2/resolve/main/edge/bundle.json');
      return !!match;
    } catch {
      return false;
    }
  }

  /**
   * Creates a caching fetch function to pass or install while loading Gapiring.
   */
  public createCachingFetch(onProgress?: (progress: DownloadProgress) => void) {
    const origFetch = globalThis.fetch.bind(globalThis);

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Only intercept model requests from Hugging Face
      if (!url.includes('islomov/gapi-uz-gapiring-v2') && !url.includes('islomov/gapi-uz-gapiring-v1')) {
        return origFetch(input, init);
      }

      if (typeof caches === 'undefined') {
        return origFetch(input, init);
      }

      const cache = await this.getCache();
      const cached = await cache.match(url);
      if (cached) {
        return cached;
      }

      // Download from network and cache
      const response = await origFetch(input, init);
      if (!response.ok) {
        return response;
      }

      // Clone response to put into cache while streaming progress
      const cloned = response.clone();
      const contentLength = Number(response.headers.get('content-length')) || 0;
      const fileName = url.split('/').pop() || 'model_file';

      if (!onProgress || !response.body) {
        await cache.put(url, cloned);
        return response;
      }

      // Track stream progress
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          parts.push(value);
          loaded += value.length;
          const percent = contentLength > 0 ? Math.round((loaded / contentLength) * 100) : 0;
          onProgress({ file: fileName, loaded, total: contentLength, percent });
        }
      }

      // Assemble full buffer
      const fullBuffer = new Uint8Array(loaded);
      let offset = 0;
      for (const p of parts) {
        fullBuffer.set(p, offset);
        offset += p.length;
      }

      const newResponse = new Response(fullBuffer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });

      await cache.put(url, newResponse.clone());
      return newResponse;
    };
  }
}
