export function createTtlCache({ ttlMs, maxSize = 5000 } = {}) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value) {
    if (store.size >= maxSize) {
      const firstKey = store.keys().next().value;
      if (firstKey) store.delete(firstKey);
    }
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function clear() {
    store.clear();
  }

  return { get, set, clear };
}
