// Redis-based caching for ideation agent using ioredis
import { Redis } from 'ioredis';
import { createCacheKey } from '../../../cache/fsCache.js';

// Cache TTL for different step types (in seconds for Redis)
const CACHE_TTL = {
  frame: 2 * 60 * 60,      // 2 hours
  ground: 24 * 60 * 60,    // 24 hours  
  skeptic: 1 * 60 * 60,    // 1 hour
  synthesize: 1 * 60 * 60  // 1 hour
};

// Redis client instance
let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: 'localhost',
      port: 6379,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });
    
    redisClient.on('error', (err) => {
      console.warn('[ideation-cache] Redis error:', err.message);
    });
    
    redisClient.on('connect', () => {
      console.log('[ideation-cache] Redis connected');
    });
  }
  return redisClient;
}

export async function readIdeationCache<T>(step: string, data: any): Promise<T | null> {
  try {
    const client = getRedisClient();
    const cacheKey = `ideation:${step}:${createCacheKey(data)}`;
    
    const cached = await client.get(cacheKey);
    if (cached) {
      console.log(`[ideation-cache] Cache hit for ${step}`);
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    console.warn('[ideation-cache] Redis read error:', error);
    return null; // Fallback gracefully
  }
}

export async function writeIdeationCache<T>(step: string, data: any, result: T): Promise<void> {
  try {
    const client = getRedisClient();
    const cacheKey = `ideation:${step}:${createCacheKey(data)}`;
    const ttl = CACHE_TTL[step as keyof typeof CACHE_TTL] || CACHE_TTL.frame;
    
    await client.setex(cacheKey, ttl, JSON.stringify(result));
    console.log(`[ideation-cache] Cached ${step} for ${ttl}s`);
  } catch (error) {
    console.warn('[ideation-cache] Redis write error:', error);
    // Continue without caching
  }
}

export async function clearIdeationCache(): Promise<void> {
  try {
    const client = getRedisClient();
    const keys = await client.keys('ideation:*');
    if (keys.length > 0) {
      await client.del(...keys);
      console.log(`[ideation-cache] Cleared ${keys.length} cache entries`);
    }
  } catch (error) {
    console.warn('[ideation-cache] Redis clear error:', error);
  }
}

// Gracefully close Redis connection
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('[ideation-cache] Redis connection closed');
  }
}