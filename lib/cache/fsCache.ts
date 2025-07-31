import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';

const CACHE_DIR = path.resolve('.cache');

export function ensureCacheDir(subdir?: string) {
  const dir = subdir ? path.join(CACHE_DIR, subdir) : CACHE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function createCacheKey(data: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function readCache<T>(key: string, subdir: string, ttlMs: number): T | null {
  try {
    const dir = ensureCacheDir(subdir);
    const filePath = path.join(dir, `${key}.json`);
    
    if (!fs.existsSync(filePath)) return null;
    
    const stats = fs.statSync(filePath);
    const age = Date.now() - stats.mtime.getTime();
    
    if (age > ttlMs) {
      fs.unlinkSync(filePath);
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, subdir: string, data: T): void {
  try {
    const dir = ensureCacheDir(subdir);
    const filePath = path.join(dir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('[cache] Failed to write cache:', error);
  }
}

export function readCompressedCache(key: string, subdir: string, ttlMs: number): string | null {
  try {
    const dir = ensureCacheDir(subdir);
    const filePath = path.join(dir, `${key}.gz`);
    
    if (!fs.existsSync(filePath)) return null;
    
    const stats = fs.statSync(filePath);
    const age = Date.now() - stats.mtime.getTime();
    
    if (age > ttlMs) {
      fs.unlinkSync(filePath);
      return null;
    }
    
    const compressed = fs.readFileSync(filePath);
    return gunzipSync(compressed).toString('utf8');
  } catch {
    return null;
  }
}

export function writeCompressedCache(key: string, subdir: string, data: string): void {
  try {
    const dir = ensureCacheDir(subdir);
    const filePath = path.join(dir, `${key}.gz`);
    const compressed = gzipSync(data);
    fs.writeFileSync(filePath, compressed);
  } catch (error) {
    console.warn('[cache] Failed to write compressed cache:', error);
  }
}

export function clearCache(subdir?: string): void {
  try {
    const dir = subdir ? path.join(CACHE_DIR, subdir) : CACHE_DIR;
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[cache] Cleared cache: ${dir}`);
    }
  } catch (error) {
    console.warn('[cache] Failed to clear cache:', error);
  }
} 