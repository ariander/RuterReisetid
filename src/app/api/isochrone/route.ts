import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = process.env.TARGOMO_KEY;
  if (!key) {
    console.error("DEBUG: TARGOMO_KEY is missing in environment variables");
    return NextResponse.json({ error: "Targomo key missing" }, { status: 500 });
  }

  try {
    const { lat, lng, transitMinutes, walkMinutes } = await req.json();
    console.log(`DEBUG: Request for ${lat},${lng}, Transit: ${transitMinutes}, Walk: ${walkMinutes}`);

    // Format date to next Monday 08:00 AM (local time string)
    const now = new Date();
    const nextMonday = new Date();
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    nextMonday.setHours(8, 0, 0, 0);
    
    // YYYY-MM-DDTHH:mm:ss in local-ish format
    const year = nextMonday.getFullYear();
    const month = String(nextMonday.getMonth() + 1).padStart(2, "0");
    const day = String(nextMonday.getDate()).padStart(2, "0");
    const timeStr = `${year}-${month}-${day}T08:00:00`;

    const totalTime = (transitMinutes + walkMinutes) * 60;
    const walkSeconds = Math.max(walkMinutes * 60, 60); // Min 1 min walk to avoid API issues

    const targomoBody = {
      sources: [{ id: "source", lat, lng }],
      edgeWeight: "time",
      travelType: "transit",
      transit: {
        frameStep: 60,
        frameDuration: 3600, // Look for departures in a 1-hour window
        maxWalkTime: walkSeconds,
        startTime: timeStr,
      },
      travelEdgeWeights: [totalTime],
      serializer: "geojson",
      polygon: {
        srid: 4326,
        simplify: 100,
        buffer: 0.0001,
      },
    };

    const response = await fetch(`https://api.targomo.com/v1/isochrone?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targomoBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DEBUG: Targomo API error:", response.status, errorText);
      return NextResponse.json({ error: `Targomo API error: ${response.status}`, details: errorText }, { status: response.status });
    }

    const data = await response.json();
    
    // Some Targomo endpoints wrap the result in a "data" property
    const geojson = data.data || data;
    
    console.log("DEBUG: Targetmo success, geometry type:", geojson?.features?.[0]?.geometry?.type || "unknown");
    return NextResponse.json(geojson);
  } catch (error: any) {
    console.error("DEBUG: Internal Server Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
