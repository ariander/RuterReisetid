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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

interface CacheEntry {
  key: string;
  stops: Stop[];
  savedAt: number;
}

export async function getCached(key: string): Promise<Stop[] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(key) as IDBRequest<CacheEntry | undefined>;
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || Date.now() - entry.savedAt > TTL_MS) {
          resolve(null);
        } else {
          resolve(entry.stops);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCached(key: string, stops: Stop[]): Promise<void> {
  try {
    const db = await openDB();
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
