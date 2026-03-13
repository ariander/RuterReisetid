import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = process.env.TARGOMO_KEY;
  if (!key) {
    console.error("DEBUG: TARGOMO_KEY is missing in environment variables");
    return NextResponse.json({ error: "Targomo key missing" }, { status: 500 });
  }

  try {
    const { lat, lng, transitMinutes, walkMinutes } = await req.json();

    // Next Monday 08:00 AM
    const now = new Date();
    const nextMonday = new Date();
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    
    const dateStr =
      nextMonday.getFullYear().toString() +
      (nextMonday.getMonth() + 1).toString().padStart(2, "0") +
      nextMonday.getDate().toString().padStart(2, "0");
    const transitFrameDate = parseInt(dateStr);
    const transitFrameTime = 8 * 3600;

    const totalTime = (transitMinutes + walkMinutes) * 60;
    const walkTimeSeconds = walkMinutes * 60;

    const targomoBody = {
      sources: [
        {
          lat,
          lng,
          id: "source",
          tm: {
            transit: {
              maxWalkingTimeFromSource: walkTimeSeconds || 60,
              maxWalkingTimeToTarget: walkTimeSeconds || 60,
            },
          },
        },
      ],
      edgeWeight: "time",
      maxEdgeWeight: totalTime,
      travelType: "transit", // Standard for polygon_post
      transitFrameDate,
      transitFrameTime,
      transitFrameDuration: 3600,
      polygon: {
        serializer: "geojson",
        srid: 4326,
        simplify: 100,
        buffer: 0.001,
        values: [totalTime],
      },
    };

    // Using the region-specific endpoint which is more reliable for West Central Europe (Norway)
    const response = await fetch(
      `https://api.targomo.com/westcentraleurope/v1/polygon_post?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targomoBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DEBUG: Targomo API error:", response.status, errorText);
      return NextResponse.json({ error: `Targomo API error: ${response.status}`, details: errorText }, { status: response.status });
    }

    const json = await response.json();
    
    // polygon_post returns { data: GeoJSON } when using geojson serializer
    const geojson = json.data || json;
    
    return NextResponse.json(geojson);
  } catch (error: any) {
    console.error("DEBUG: Internal Server Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
