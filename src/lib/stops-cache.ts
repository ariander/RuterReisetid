import type { Stop } from "./entur-stops";

const DB_NAME = "reisetid-stops";
const STORE   = "tiles";
const VERSION = 1;
const TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

// Tile resolution: 0.1° lat × 0.1° lng ≈ 11 km × 7 km at 60° N
// Slightly larger than the 8 km fetch radius so each tile covers one fetch area.
export const TILE_RES = 0.1;

export function tileKey(lat: number, lng: number): string {
  return `${(Math.round(lat / TILE_RES) * TILE_RES).toFixed(1)},${(Math.round(lng / TILE_RES) * TILE_RES).toFixed(1)}`;
}

// ── Singleton DB connection ───────────────────────────────────────────────────
// Opened once on first use; all subsequent calls reuse the same promise.
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

interface CacheEntry {
  key: string;
  stops: Stop[];
  savedAt: number;
}

export async function getCached(key: string): Promise<Stop[] | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const req = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(key) as IDBRequest<CacheEntry | undefined>;
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || Date.now() - entry.savedAt > TTL_MS) resolve(null);
        else resolve(entry.stops);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Read multiple tile keys in a single transaction — much faster than N separate reads. */
export async function getManyCached(keys: string[]): Promise<Map<string, Stop[]>> {
  const result = new Map<string, Stop[]>();
  if (keys.length === 0) return result;
  try {
    const db = await getDB();
    await new Promise<void>((resolve) => {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      let pending = keys.length;
      const done = () => { if (--pending === 0) resolve(); };
      for (const key of keys) {
        const req = store.get(key) as IDBRequest<CacheEntry | undefined>;
        req.onsuccess = () => {
          const entry = req.result;
          if (entry && Date.now() - entry.savedAt <= TTL_MS) result.set(key, entry.stops);
          done();
        };
        req.onerror = done;
      }
    });
  } catch {
    // return whatever we managed to read
  }
  return result;
}

export async function putCached(key: string, stops: Stop[]): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const req = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put({ key, stops, savedAt: Date.now() } satisfies CacheEntry);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch {
    // Cache write failures are silent — app still works
  }
}

/** Write multiple tiles in a single readwrite transaction. */
export async function putManyCached(entries: { key: string; stops: Stop[] }[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const now = Date.now();
      for (const { key, stops } of entries) {
        store.put({ key, stops, savedAt: now } satisfies CacheEntry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // silent
  }
}
