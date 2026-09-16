interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private static store = new Map<string, CacheEntry<any>>();

  static set<T>(key: string, value: T, ttlSeconds = 60): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }

  static get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  static delete(key: string): void {
    this.store.delete(key);
  }

  static clear(): void {
    this.store.clear();
  }

  static getStats() {
    return {
      size: this.store.size,
      memoryUsageBytes: process.memoryUsage().heapUsed,
    };
  }
}
