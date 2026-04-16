import { tileKey, TILE_RES, getCached, putCached, getManyCached, putManyCached } from "./stops-cache";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  modes: string[]; // all transport modes, sorted by priority
}

const PRIORITY = ["metro", "rail", "tram", "water", "bus", "coach"];

function parseStops(edges: any[]): Stop[] {
  return edges.map((edge: any) => {
    const raw: string[] = Array.isArray(edge.node.place.transportMode)
      ? edge.node.place.transportMode
      : [edge.node.place.transportMode ?? "bus"];

    const modes = [...new Set(raw)].sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    return {
      id: edge.node.place.id,
      name: edge.node.place.name,
      lat: edge.node.place.latitude,
      lng: edge.node.place.longitude,
      modes,
    };
  });
}

/** Original per-tile fetch — kept for compatibility */
export async function getNearbyStops(lat: number, lng: number, distance = 1500, maxRes = 500): Promise<Stop[]> {
  const key = tileKey(lat, lng);
  const cached = await getCached(key);
  if (cached) return cached;

  const query = `{
    nearest(
      latitude: ${lat}
      longitude: ${lng}
      maximumDistance: ${distance}
      filterByPlaceTypes: [stopPlace]
      maximumResults: ${maxRes}
    ) {
      edges {
        node {
          place {
            ... on StopPlace {
              id name latitude longitude transportMode
            }
          }
        }
      }
    }
  }`;

  const res = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": "ruter-reisetid-poc",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const stops = parseStops(data.data?.nearest?.edges ?? []);
  await putCached(key, stops);
  return stops;
}

/**
 * Fetch all stops visible in a viewport with a SINGLE Entur request.
 *
 * Strategy:
 * 1. Compute all tile keys for the viewport.
 * 2. Read already-cached tiles from IndexedDB in one batch transaction.
 * 3. If any tiles are missing, fire ONE Entur `nearest` query from the
 *    viewport center with a radius large enough to cover the whole viewport.
 * 4. Distribute the results into tiles and write them to IDB in one batch.
 * 5. Return all stops (cached + freshly fetched).
 *
 * This replaces the old "one Entur request per tile" approach, cutting
 * N parallel network calls down to 1.
 */
export async function getStopsInBounds(
  bounds: { n: number; s: number; e: number; w: number },
  fetchedTiles: Set<string>,
): Promise<Stop[]> {
  // ── 1. Collect tile keys for this viewport ────────────────────────────────
  const tileKeys: string[] = [];
  const tileCenters: { key: string; lat: number; lng: number }[] = [];

  for (
    let lat = Math.round(bounds.s / TILE_RES) * TILE_RES;
    lat <= bounds.n + TILE_RES;
    lat = Math.round((lat + TILE_RES) * 10) / 10
  ) {
    for (
      let lng = Math.round(bounds.w / TILE_RES) * TILE_RES;
      lng <= bounds.e + TILE_RES;
      lng = Math.round((lng + TILE_RES) * 10) / 10
    ) {
      const key = tileKey(lat, lng);
      tileKeys.push(key);
      tileCenters.push({ key, lat, lng });
    }
  }

  // ── 2. Batch-read cache ───────────────────────────────────────────────────
  const cachedMap = await getManyCached(tileKeys);

  // Collect all stops from cache; identify tiles still missing
  const allStops = new Map<string, Stop>();
  const missingKeys = new Set<string>();

  for (const { key } of tileCenters) {
    const cached = cachedMap.get(key);
    if (cached) {
      for (const s of cached) allStops.set(s.id, s);
    } else if (!fetchedTiles.has(key)) {
      missingKeys.add(key);
    }
  }

  // Mark all tiles as fetched (even before the network call returns, to
  // prevent duplicate in-flight requests on rapid pan/zoom).
  for (const key of missingKeys) fetchedTiles.add(key);

  if (missingKeys.size === 0) return Array.from(allStops.values());

  // ── 3. ONE Entur fetch for the whole viewport ─────────────────────────────
  // Viewport center
  const centerLat = (bounds.n + bounds.s) / 2;
  const centerLng = (bounds.e + bounds.w) / 2;

  // Half-diagonal of the viewport in degrees → metres (rough conversion at 60°N)
  const dLat = (bounds.n - bounds.s) / 2;
  const dLng = (bounds.e - bounds.w) / 2;
  const radiusM = Math.ceil(
    Math.sqrt((dLat * 111_000) ** 2 + (dLng * 63_000) ** 2)
  );
  // Add 20% padding and cap at 40 km so we don't hammer Entur on wide zooms
  const fetchRadius = Math.min(Math.ceil(radiusM * 1.2), 40_000);

  const query = `{
    nearest(
      latitude: ${centerLat}
      longitude: ${centerLng}
      maximumDistance: ${fetchRadius}
      filterByPlaceTypes: [stopPlace]
      maximumResults: 2000
    ) {
      edges {
        node {
          place {
            ... on StopPlace {
              id name latitude longitude transportMode
            }
          }
        }
      }
    }
  }`;

  try {
    const res = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ET-Client-Name": "ruter-reisetid-poc",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return Array.from(allStops.values());

    const data = await res.json();
    const freshStops = parseStops(data.data?.nearest?.edges ?? []);

    // Add to result map
    for (const s of freshStops) allStops.set(s.id, s);

    // ── 4. Distribute into tiles + batch-write to IDB ─────────────────────
    // Build a map of tile-key → stops that belong to that tile
    const tileStops = new Map<string, Stop[]>();
    for (const key of missingKeys) tileStops.set(key, []);

    for (const stop of freshStops) {
      const key = tileKey(stop.lat, stop.lng);
      if (missingKeys.has(key)) {
        tileStops.get(key)!.push(stop);
      }
    }

    // Write tiles that had results; also write empty arrays so we don't
    // re-fetch tiles that genuinely have no stops (e.g. water tiles).
    await putManyCached(
      Array.from(tileStops.entries()).map(([key, stops]) => ({ key, stops }))
    );
  } catch {
    // Network failure — unmark tiles so they can be retried on next viewport change
    for (const key of missingKeys) fetchedTiles.delete(key);
  }

  return Array.from(allStops.values());
}
