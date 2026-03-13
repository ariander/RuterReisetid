import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = process.env.TARGOMO_KEY;
  if (!key) {
    console.error("TARGOMO_KEY is missing in environment variables");
    return NextResponse.json({ error: "Targomo key missing" }, { status: 500 });
  }

  try {
    const { lat, lng, transitMinutes, walkMinutes } = await req.json();

    // Format date to next Monday 08:00 AM
    const now = new Date();
    const nextMonday = new Date();
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    nextMonday.setHours(8, 0, 0, 0);
    const timeStr = nextMonday.toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss

    const totalTime = (transitMinutes + walkMinutes) * 60;

    const response = await fetch(`https://api.targomo.com/v1/isochrone?key=${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sources: [{ id: "source", lat, lng }],
        edgeWeight: "time",
        travelType: "transit",
        transit: {
          frameStep: 60,
          frameDuration: totalTime,
          maxWalkTime: walkMinutes * 60,
          startTime: timeStr,
        },
        travelEdgeWeights: [totalTime],
        serializer: "geojson",
        polygon: {
          srid: 4326,
          simplify: 100,
          buffer: 0.0001,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Targomo API error:", response.status, errorText);
      return NextResponse.json({ error: `Targomo API error: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    // For the v1/isochrone endpoint with geojson serializer, the response IS the geojson
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Internal Server Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
