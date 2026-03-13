"use client";

import { useState, useEffect, useCallback } from "react";
import { MapView } from "@/components/Map";
import { SearchBar } from "@/components/SearchBar";
import { TimeSelector } from "@/components/TimeSelector";
import { getIsochrone } from "@/lib/targomo";
import Image from "next/image";

const MAX_TOTAL_SECONDS = 900; // API limit: 15 minutes

export default function Home() {
  const [location, setLocation] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [transitTime, setTransitTime] = useState(10);
  const [walkTime, setWalkTime] = useState(5);
  const [isochrone, setIsochrone] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);

  const totalSeconds = (transitTime + walkTime) * 60;
  const exceedsLimit = totalSeconds > MAX_TOTAL_SECONDS;

  const fetchIsochrone = useCallback(async (lat: number, lng: number, transit: number, walk: number) => {
    if ((transit + walk) * 60 > MAX_TOTAL_SECONDS) return;
    setLoading(true);
    try {
      const data = await getIsochrone(lat, lng, transit, walk);
      setIsochrone(data);
    } catch (err) {
      console.error("Fetch isochrone error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (location && !exceedsLimit) {
      fetchIsochrone(location.lat, location.lng, transitTime, walkTime);
    }
  }, [location, transitTime, walkTime, fetchIsochrone, exceedsLimit]);

  const handleTransitChange = (val: string) => {
    const v = parseInt(val);
    setTransitTime(v);
    if ((v + walkTime) * 60 > MAX_TOTAL_SECONDS) {
      setShowLimitDialog(true);
    }
  };

  const handleWalkChange = (val: string) => {
    const v = parseInt(val);
    setWalkTime(v);
    if ((transitTime + v) * 60 > MAX_TOTAL_SECONDS) {
      setShowLimitDialog(true);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    setLocation({ lat, lng, name: "" });
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-slate-50">
      {/* Top panel: logo + search + time selectors */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
        <div className="bg-white/80 backdrop-blur-lg rounded-2xl shadow-lg px-3 py-2.5">
          {/* Row 1: Logo + Search */}
          <div className="flex items-center gap-3">
            <Image src="/reisetid-logo.svg" alt="Reisetid" width={96} height={96} className="shrink-0" />
            <SearchBar onSelect={setLocation} />
          </div>

          {/* Divider */}
          <div className="h-px bg-ink-primary/10 mx-1 my-2" />

          {/* Row 2: Time selectors */}
          <TimeSelector
            transitTime={transitTime}
            walkTime={walkTime}
            onTransitChange={handleTransitChange}
            onWalkChange={handleWalkChange}
            exceedsLimit={exceedsLimit}
          />
        </div>
      </div>

      {/* Map */}
      <MapView
        center={location || undefined}
        isochrone={isochrone}
        onMapClick={handleMapClick}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px] z-[100] flex items-center justify-center">
          <div className="bg-white p-5 rounded-2xl shadow-2xl flex items-center gap-3">
            <div className="w-5 h-5 border-3 border-ink-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-medium text-ink-primary text-sm">Beregner reisetid...</span>
          </div>
        </div>
      )}

      {/* API limit dialog */}
      {showLimitDialog && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="font-bold text-ink-primary text-lg mb-2">API-begrensning</h2>
            <p className="text-ink-primary/70 text-sm mb-1">
              Gratis Targomo API tillater maks <strong>15 minutter</strong> total reisetid (kollektiv + gange).
            </p>
            <p className="text-ink-primary/70 text-sm mb-5">
              Du har valgt {transitTime} + {walkTime} = {transitTime + walkTime} minutter. Reduser til maks 15 for å beregne, eller oppgrader API-nøkkelen.
            </p>
            <button
              onClick={() => setShowLimitDialog(false)}
              className="w-full bg-ink-primary text-white font-medium py-2.5 rounded-xl hover:opacity-90 transition-opacity"
            >
              OK, forstått
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
