import { tavilySearch } from './clients.js';
import { readCache, writeCache, createCacheKey } from '../cache/fsCache.js';

const TAVILY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function tavilySearchCached(params: {
  query: string;
  maxResults?: number;
  timeRange?: 'day'|'week'|'month'|'year';
  searchDepth?: 'basic'|'advanced';
  includeDomains?: string[];
  excludeDomains?: string[];
  includeRawContent?: boolean;
}): Promise<{ items: Array<{ url: string; title?: string; snippet?: string; published_at?: string; raw_content?: string }> }> {
  const cacheKey = createCacheKey(params);
  
  // Try cache first
  const cached = readCache<{ items: Array<{ url: string; title?: string; snippet?: string; published_at?: string; raw_content?: string }> }>(cacheKey, 'tavily', TAVILY_CACHE_TTL);
  if (cached) {
    console.log('[tavily-cache] Cache hit for query:', params.query.substring(0, 50) + '...');
    return cached;
  }
  
  // Cache miss - make live API call
  console.log('[tavily-cache] Cache miss, making API call for:', params.query.substring(0, 50) + '...');
  const result = await tavilySearch(params);
  
  // Store in cache
  writeCache(cacheKey, 'tavily', result);
  
  return result;
} 