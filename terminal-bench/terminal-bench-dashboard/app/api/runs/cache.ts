interface CachedRun {
  data: any;
  lastModified: number;
  lastChecked: number;
}

class RunsCache {
  private cache = new Map<string, CachedRun>();
  private readonly CACHE_TTL = 2000; // 2 seconds
  private readonly CHECK_INTERVAL = 1000; // Check filesystem every 1 second

  async getCachedRun(runId: string, runPath: string): Promise<{ data: any; fromCache: boolean }> {
    const now = Date.now();
    const cached = this.cache.get(runId);
    
    // If we have cached data and it's not time to check filesystem yet
    if (cached && (now - cached.lastChecked) < this.CHECK_INTERVAL) {
      return { data: cached.data, fromCache: true };
    }
    
    // Check if the run directory has been modified
    try {
      const fs = require('fs/promises');
      const stats = await fs.stat(runPath);
      const lastModified = stats.mtime.getTime();
      
      // If cached data exists and directory hasn't changed, return cached
      if (cached && cached.lastModified >= lastModified) {
        // Update lastChecked to avoid frequent filesystem checks
        cached.lastChecked = now;
        return { data: cached.data, fromCache: true };
      }
      
      // Data is stale or doesn't exist, needs refresh
      return { data: null, fromCache: false };
      
    } catch (error) {
      // Directory doesn't exist or error accessing it
      this.cache.delete(runId);
      return { data: null, fromCache: false };
    }
  }
  
  setCachedRun(runId: string, runPath: string, data: any): void {
    const fs = require('fs');
    try {
      const stats = fs.statSync(runPath);
      this.cache.set(runId, {
        data,
        lastModified: stats.mtime.getTime(),
        lastChecked: Date.now()
      });
    } catch {
      // If we can't stat the directory, don't cache
    }
  }
  
  // Clean up old cache entries
  cleanup(): void {
    const now = Date.now();
    for (const [runId, cached] of this.cache.entries()) {
      if (now - cached.lastChecked > this.CACHE_TTL * 5) {
        this.cache.delete(runId);
      }
    }
  }
  
  // Get cache stats for debugging
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Global cache instance
const runsCache = new RunsCache();

// Cleanup old entries every 30 seconds
setInterval(() => runsCache.cleanup(), 30000);

export default runsCache;