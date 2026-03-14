"use client";

import { useState, useEffect, useCallback } from "react";
import { MapView } from "@/components/Map";
import { SearchBar } from "@/components/SearchBar";
import { TimeSelector } from "@/components/TimeSelector";
import { getIsochrone } from "@/lib/targomo";
import { getNearbyStops, type Stop } from "@/lib/entur-stops";
import Image from "next/image";

export default function Home() {
  const [location, setLocation] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [lastMileMode, setLastMileMode] = useState<"walk" | "scooter">("walk");
  const [transitTime, setTransitTime] = useState(10);
  const [walkTime, setWalkTime] = useState(5);
  const [isochrone, setIsochrone] = useState<any>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchIsochrone = useCallback(async (
    lat: number, lng: number,
    transit: number, walk: number,
    mode: "walk" | "scooter"
  ) => {
    setLoading(true);
    try {
      const data = await getIsochrone(lat, lng, transit, walk, mode);
      setIsochrone(data);
    } catch (err) {
      console.error("Fetch isochrone error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (location) {
      fetchIsochrone(location.lat, location.lng, transitTime, walkTime, lastMileMode);
    }
  }, [location, transitTime, walkTime, lastMileMode, fetchIsochrone]);

  const handleViewChange = useCallback((lat: number, lng: number) => {
    getNearbyStops(lat, lng).then(setStops).catch(console.error);
  }, []);

  const handleMapClick = (lat: number, lng: number) =>
    setLocation({ lat, lng, name: "" });

  return (
    <main className="relative w-full h-dvh overflow-hidden">
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[110] w-full max-w-md px-4"
        style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg px-3 py-2.5 z-index-99">
          <div className="flex items-center gap-3 pl-2">
            <Image src="/reisetid-logo.svg" alt="Reisetid" width={96} height={96} className="shrink-0" />
            <SearchBar onSelect={setLocation} />
          </div>

          <div className="h-px bg-ink-primary/10 mx-1 my-2" />

          <TimeSelector
            lastMileMode={lastMileMode}
            transitTime={transitTime}
            walkTime={walkTime}
            onLastMileModeChange={setLastMileMode}
            onTransitChange={(val) => setTransitTime(parseInt(val))}
            onWalkChange={(val) => setWalkTime(parseInt(val))}
          />
        </div>
      </div>

      <MapView
        center={location || undefined}
        isochrone={isochrone}
        stops={stops}
        onMapClick={handleMapClick}
        onViewChange={handleViewChange}
      />

      {loading && (
        <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px] z-[100] flex items-center justify-center">
          <div className="bg-white p-5 rounded-2xl shadow-2xl flex items-center gap-3">
            <div className="w-5 h-5 border-3 border-ink-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-medium text-ink-primary text-sm">Beregner reisetid...</span>
          </div>
        </div>
      )}
    </main>
  );
}
