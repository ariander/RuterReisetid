/**
 * Ferry reachability via Entur Journey Planner.
 *
 * Targomo's routing engine may lack Norwegian ferry lines (e.g. Nesoddbåten B10).
 * This module queries Entur — which has full Norwegian GTFS data — to find which
 * ferry terminals are reachable within the time budget. The caller can then fire
 * secondary Targomo isochrone requests *from* those terminals with the remaining
 * time budget, giving accurate road/transit coverage beyond the water crossing.
 */

interface FerryStop {
  name: string;
  lat: number;
  lng: number;
}

export interface ReachableFerryStop extends FerryStop {
  /** Total journey duration in seconds from the user's source to this terminal */
  tripSeconds: number;
}

/**
 * Known ferry terminal stops in the Oslo fjord that require water transit to reach.
 * Coordinates point to the ferry dock/terminal itself.
 */
const OSLO_FERRY_STOPS: FerryStop[] = [
  // Nesoddbåten (B10) — Aker Brygge → Nesoddtangen (year-round)
  { name: "Nesoddtangen",  lat: 59.8707, lng: 10.6570 },
  // Bunnefjord ferries (B30 / B31 / B32 — year-round)
  { name: "Steilene",      lat: 59.7970, lng: 10.5671 },
  { name: "Håøya",         lat: 59.7360, lng: 10.5750 },
  // Oslofjord island ferries (B1 / B2 / B3 — seasonal, summer only)
  { name: "Gressholmen",   lat: 59.8773, lng: 10.6998 },
  { name: "Bleikøya",      lat: 59.8622, lng: 10.7175 },
  { name: "Lindøya",       lat: 59.8668, lng: 10.7112 },
  { name: "Nakholmen",     lat: 59.8614, lng: 10.7037 },
  { name: "Langøyene",     lat: 59.8543, lng: 10.7082 },
];

/**
 * Query Entur Journey Planner for the shortest ferry-inclusive trip duration
 * (in seconds) from source to a ferry terminal.
 * Returns null if no ferry route found or on timeout/error.
 */
async function enturFerryTripSeconds(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  isoDateTime: string,
): Promise<number | null> {
  const query = `{
    trip(
      from: { coordinates: { latitude: ${fromLat}, longitude: ${fromLng} } }
      to:   { coordinates: { latitude: ${toLat},   longitude: ${toLng}   } }
      dateTime: "${isoDateTime}"
      numTripPatterns: 5
      walkSpeed: 1.4
    ) {
      tripPatterns {
        duration
        legs { mode }
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
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const patterns: any[] = data.data?.trip?.tripPatterns ?? [];

    // Only consider trips with a water (ferry) leg — filters out slow road detours
    const ferryTrips = patterns.filter((p) =>
      p.legs.some((l: any) => l.mode === "water"),
    );
    if (ferryTrips.length === 0) return null;

    return Math.min(...ferryTrips.map((p: any) => p.duration as number));
  } catch {
    return null;
  }
}

/**
 * Bounding box for the Oslo fjord area.
 * Ferry augmentation is only relevant here — skip entirely for other regions.
 */
const OSLO_FJORD_BOUNDS = {
  latMin: 59.4, latMax: 60.2,
  lngMin: 10.0, lngMax: 11.5,
};

/** Shortest possible ferry journey from anywhere in the Oslo area (minutes). */
const MIN_FERRY_BUDGET_SECONDS = 20 * 60;

/**
 * Find all Oslo-fjord ferry terminals reachable from (fromLat, fromLng) via a
 * ferry-inclusive journey within totalBudgetSeconds.
 *
 * Returns an empty array immediately if:
 *  - the source is outside the Oslo fjord area, or
 *  - the total budget is too small to reach any ferry terminal
 *
 * @param fromLat            User's source latitude
 * @param fromLng            User's source longitude
 * @param totalBudgetSeconds Total journey budget (transit + last-mile)
 * @param isoDateTime        ISO 8601 departure time ("2026-03-16T16:00:00+01:00")
 * @returns Stops that are reachable, with the trip duration used to get there
 */
export async function getReachableFerryStops(
  fromLat: number,
  fromLng: number,
  totalBudgetSeconds: number,
  isoDateTime: string,
): Promise<ReachableFerryStop[]> {
  const { latMin, latMax, lngMin, lngMax } = OSLO_FJORD_BOUNDS;
  if (
    fromLat < latMin || fromLat > latMax ||
    fromLng < lngMin || fromLng > lngMax ||
    totalBudgetSeconds < MIN_FERRY_BUDGET_SECONDS
  ) {
    return [];
  }

  const results = await Promise.allSettled(
    OSLO_FERRY_STOPS.map(async (stop) => {
      const tripSec = await enturFerryTripSeconds(
        fromLat, fromLng,
        stop.lat, stop.lng,
        isoDateTime,
      );
      if (tripSec === null || tripSec >= totalBudgetSeconds) return null;
      return { ...stop, tripSeconds: tripSec };
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<ReachableFerryStop> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
}
