import "server-only";

// In-memory TTL cache. Prototype-scale only (single process, lost on restart) —
// see CLAUDE.md before reaching for Redis.

interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

// Stored on globalThis so dev-mode hot reloads don't discard the cache.
const store: Map<string, Entry<unknown>> = ((globalThis as { __knitknackCache?: Map<string, Entry<unknown>> })
  .__knitknackCache ??= new Map());

/**
 * Returns the cached value for `key`, or runs `load` and caches its result for `ttlMs`.
 * Concurrent callers share one in-flight load; failed loads are not cached.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const value = load();
  store.set(key, { expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}
