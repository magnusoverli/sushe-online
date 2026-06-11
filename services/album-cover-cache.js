const defaultLogger = require('../utils/logger');
const {
  incCoverCacheEvictions,
  incCoverCacheHit,
  incCoverCacheMiss,
  updateCoverCacheMetrics,
} = require('../utils/metrics');

function normalizeVersion(version) {
  return version === undefined || version === null ? '' : String(version);
}

function coverCacheKey(albumId, size, version) {
  return `${albumId}:${size || 'full'}:${normalizeVersion(version)}`;
}

class AlbumCoverCache {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    this.maxItems = options.maxItems ?? 10000;
    this.logger = options.logger || defaultLogger;
    this.cache = new Map();
    this.totalBytes = 0;
    this.evictions = 0;
    this.updateMetrics();
  }

  updateMetrics() {
    updateCoverCacheMetrics(this.totalBytes, this.cache.size);
  }

  get({ albumId, size = 'full', version }) {
    if (!this.enabled || !albumId || !version) return null;

    const key = coverCacheKey(albumId, size, version);
    const entry = this.cache.get(key);
    if (!entry) {
      incCoverCacheMiss();
      return null;
    }

    // Refresh insertion order for LRU behavior.
    this.cache.delete(key);
    this.cache.set(key, entry);
    incCoverCacheHit();
    return entry;
  }

  set({ albumId, size = 'full', version, imageBuffer, contentType, headers }) {
    if (
      !this.enabled ||
      !albumId ||
      !version ||
      !Buffer.isBuffer(imageBuffer)
    ) {
      return false;
    }

    if (imageBuffer.length > this.maxBytes) {
      this.logger.debug('Album cover cache skipped oversized entry', {
        albumId,
        size,
        bytes: imageBuffer.length,
        maxBytes: this.maxBytes,
      });
      return false;
    }

    const key = coverCacheKey(albumId, size, version);
    const existing = this.cache.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.cache.delete(key);
    }

    const entry = {
      albumId,
      size,
      version: normalizeVersion(version),
      imageBuffer,
      contentType,
      headers: Object.fromEntries(
        Object.entries(headers || {}).filter(
          ([, value]) => value !== undefined && value !== null
        )
      ),
      bytes: imageBuffer.length,
      createdAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.totalBytes += entry.bytes;
    this.enforceLimits();
    this.updateMetrics();
    return this.cache.has(key);
  }

  enforceLimits() {
    let evicted = 0;
    while (
      this.cache.size > 0 &&
      (this.cache.size > this.maxItems || this.totalBytes > this.maxBytes)
    ) {
      const oldestKey = this.cache.keys().next().value;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.totalBytes -= oldest?.bytes || 0;
      evicted++;
    }

    if (evicted > 0) {
      this.evictions += evicted;
      incCoverCacheEvictions(evicted);
      this.logger.debug('Album cover cache evicted entries', {
        evicted,
        cacheSize: this.cache.size,
        totalBytes: this.totalBytes,
      });
    }
  }

  invalidateAlbum(albumId) {
    if (!albumId) return 0;

    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.albumId === albumId) {
        this.cache.delete(key);
        this.totalBytes -= entry.bytes;
        removed++;
      }
    }

    if (removed > 0) {
      this.updateMetrics();
    }
    return removed;
  }

  clear() {
    this.cache.clear();
    this.totalBytes = 0;
    this.updateMetrics();
  }

  getStats() {
    return {
      enabled: this.enabled,
      items: this.cache.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
      maxItems: this.maxItems,
      evictions: this.evictions,
    };
  }
}

function createAlbumCoverCache(options = {}) {
  return new AlbumCoverCache(options);
}

module.exports = {
  AlbumCoverCache,
  createAlbumCoverCache,
  coverCacheKey,
};
