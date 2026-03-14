import { NextRequest, NextResponse } from "next/server";
import { getReachableFerryStops } from "@/lib/entur-ferry";

/**
 * Fire a Targomo polygon request from a ferry terminal with the remaining
 * time budget.  The transit frame is shifted to reflect the ferry arrival
 * time so local bus connections are timed correctly.
 *
 * @returns Array of GeoJSON features, or null on error
 */
async function ferryTerminalPolygon(
  lat: number,
  lng: number,
  remainingSeconds: number,
  lastMileSeconds: number,
  arrivalFrameTime: number,   // seconds from midnight (= 16:00 + trip duration)
  dateInt: number,
  key: string,
): Promise<any[] | null> {
  const walkSec = Math.min(lastMileSeconds, remainingSeconds);

  const body = {
    sources: [
      {
        lat, lng, id: "ferry-terminal",
        tm: {
          transit: {
            maxWalkingTimeFromSource: walkSec,
            maxWalkingTimeToTarget: walkSec,
          },
        },
      },
    ],
    edgeWeight: "time",
    maxEdgeWeight: remainingSeconds,
    transitFrameDate: dateInt,
    transitFrameTime: arrivalFrameTime,
    transitFrameDuration: 45 * 60,
    polygon: {
      serializer: "geojson",
      srid: 4326,
      simplify: 100,
      buffer: 0.001,
      values: [remainingSeconds],
    },
  };

  try {
    const res = await fetch(
      `https://api.targomo.com/westcentraleurope/v1/polygon_post?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.data || json;
    return data?.features ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const key = process.env.TARGOMO_KEY;
  if (!key) {
    return NextResponse.json({ error: "Targomo key missing" }, { status: 500 });
  }

  try {
    const { lat, lng, transitMinutes, walkMinutes, lastMileMode } = await req.json();
    const walkTimeSeconds = walkMinutes * 60;
    const transitTimeSeconds = transitMinutes * 60;

    // Scooter covers ~3x the distance of walking in the same time.
    // To model this: expand the walking budget 3x so Targomo can reach farther stops,
    // and increase maxEdgeWeight accordingly so transit still gets its full time budget.
    const lastMileSeconds = lastMileMode === "scooter"
      ? (walkTimeSeconds * 3 || 60)
      : (walkTimeSeconds || 60);
    const useTransit = transitMinutes > 0;

    // Total journey budget = transit time + last-mile walking.
    // This matches exactly what the UI displays (e.g. "45 min + 30 min = 75 min").
    // Ferry-reachable areas (Nesodden etc.) that Targomo misses are handled separately
    // via Entur + secondary Targomo calls below — no need to inflate this budget.
    const totalTime = useTransit
      ? transitTimeSeconds + lastMileSeconds
      : lastMileSeconds;

    // Use the next upcoming weekday at 16:00 (afternoon rush hour)
    const now = new Date();
    const daysUntilWeekday = [6, 0].includes(now.getDay())
      ? (8 - now.getDay()) % 7 || 1   // Sat → Mon (2), Sun → Mon (1)
      : 0;                              // Already a weekday — use today
    const weekday = new Date();
    weekday.setDate(now.getDate() + daysUntilWeekday);
    const dateStr =
      weekday.getFullYear().toString() +
      (weekday.getMonth() + 1).toString().padStart(2, "0") +
      weekday.getDate().toString().padStart(2, "0");

    // When transitMinutes = 0, use pure walking mode (no transit hops possible)
    const sourceTm = useTransit
      ? {
          transit: {
            maxWalkingTimeFromSource: lastMileSeconds,
            maxWalkingTimeToTarget: lastMileSeconds,
          },
        }
      : { walk: {} };

    // 45-minute frame: models "I can time my departure to the best transit
    // connection within a 45-minute afternoon rush window" — invisible to user.
    const transitFrameDuration = 45 * 60;

    const targomoBody = {
      sources: [
        {
          lat, lng, id: "source",
          tm: sourceTm,
        },
      ],
      edgeWeight: "time",
      maxEdgeWeight: totalTime,
      ...(useTransit && {
        transitFrameDate: parseInt(dateStr),
        transitFrameTime: 16 * 3600,       // 16:00 — afternoon rush hour
        transitFrameDuration,
      }),
      polygon: {
        serializer: "geojson",
        srid: 4326,
        simplify: 100,
        buffer: 0.001,
        values: [totalTime],
      },
    };

    // ISO datetime for Entur (16:00 CET, same window as Targomo transit frame)
    const isoDateTime =
      `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}` +
      `T16:00:00+01:00`;

    // ── Fire main Targomo + Entur ferry checks in parallel ───────────────────
    // getReachableFerryStops returns [] immediately if source is outside the
    // Oslo fjord area or the budget is too small, so it's safe to always call.
    const [response, ferryStops] = await Promise.all([
      fetch(
        `https://api.targomo.com/westcentraleurope/v1/polygon_post?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targomoBody),
        },
      ),
      useTransit
        ? getReachableFerryStops(lat, lng, totalTime, isoDateTime).catch((e) => {
            console.warn("Ferry stops check failed:", e);
            return [];
          })
        : Promise.resolve([]),
    ]);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Targomo API error:", response.status, errorText);
      return NextResponse.json({ error: `Targomo API error: ${response.status}` }, { status: response.status });
    }

    const json = await response.json();
    const targomoData = json.data || json;

    // ── Secondary Targomo calls from reachable ferry terminals ────────────────
    // Entur told us which ferry stops are reachable within the budget.
    // Now fire Targomo from each of those terminals with the remaining budget
    // — this gives accurate road/transit coverage beyond the water crossing.
    if (ferryStops.length > 0 && targomoData?.features) {
      const secondaryResults = await Promise.allSettled(
        ferryStops
          .filter((stop) => totalTime - stop.tripSeconds >= 600) // ≥ 10 min remaining
          .map((stop) =>
            ferryTerminalPolygon(
              stop.lat,
              stop.lng,
              totalTime - stop.tripSeconds,
              lastMileSeconds,
              16 * 3600 + stop.tripSeconds,
              parseInt(dateStr),
              key,
            ),
          ),
      );

      for (const result of secondaryResults) {
        if (result.status === "fulfilled" && result.value) {
          targomoData.features = [...targomoData.features, ...result.value];
        }
      }
    }

    return NextResponse.json(targomoData);
  } catch (error: any) {
    console.error("Isochrone error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
