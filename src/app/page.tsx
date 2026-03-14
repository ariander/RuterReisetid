"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MapView } from "@/components/Map";
import { SearchBar } from "@/components/SearchBar";
import { TimeSelector } from "@/components/TimeSelector";
import { getIsochrone } from "@/lib/targomo";
import { getNearbyStops, type Stop } from "@/lib/entur-stops";
import Image from "next/image";

/**
 * Rough bounding box for Østlandet / the Ruter service area.
 * Outside this box the ferry augmentation (hardcoded Oslo-fjord stops)
 * won't apply, so we warn the user.
 */
function isOutsideOstlandet(lat: number, lng: number) {
  return lat < 58.8 || lat > 61.2 || lng < 9.2 || lng > 12.5;
}

export default function Home() {
  const [location, setLocation] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [lastMileMode, setLastMileMode] = useState<"walk" | "scooter">("walk");
  const [transitTime, setTransitTime] = useState(10);
  const [walkTime, setWalkTime] = useState(5);
  const [isochrone, setIsochrone] = useState<any>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);

  // Loading overlay visual state (decoupled from `loading` so exit can animate)
  const [loadingVisible, setLoadingVisible] = useState(false);
  const [loadingLeaving, setLoadingLeaving] = useState(false);
  const loadingShowRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ferry warning toast state
  const [ferryWarning, setFerryWarning] = useState(false);
  const [ferryLeaving, setFerryLeaving] = useState(false);
  const ferryAutoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ferryLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // iOS viewport-height fix: `fixed inset-0` on iOS (especially PWA mode) doesn't
  // always reach the physical bottom due to safe-area / browser-chrome quirks.
  // We measure the real innerHeight and store it as --app-height so the map
  // fills the full screen.
  useEffect(() => {
    const setAppHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
    };
    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    return () => window.removeEventListener("resize", setAppHeight);
  }, []);

  // Sync loading overlay: wait 200ms before showing (skips overlay for fast
  // responses), then animate out smoothly when done.
  useEffect(() => {
    if (loading) {
      if (loadingLeaveRef.current) clearTimeout(loadingLeaveRef.current);
      setLoadingLeaving(false);
      loadingShowRef.current = setTimeout(() => setLoadingVisible(true), 200);
    } else {
      if (loadingShowRef.current) clearTimeout(loadingShowRef.current);
      setLoadingLeaving(true);
      loadingLeaveRef.current = setTimeout(() => {
        setLoadingVisible(false);
        setLoadingLeaving(false);
      }, 300);
    }
  }, [loading]);

  /** Animate the toast out, then remove it from DOM after the transition. */
  const dismissFerry = useCallback(() => {
    if (ferryAutoTimer.current) clearTimeout(ferryAutoTimer.current);
    setFerryLeaving(true);
    ferryLeaveTimer.current = setTimeout(() => {
      setFerryWarning(false);
      setFerryLeaving(false);
    }, 350);
  }, []);

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

  // Smart debounce: map clicks fire immediately; time/mode changes wait 400 ms.
  // This prevents a burst of API calls when the user adjusts the dropdowns.
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLocationRef  = useRef<typeof location>(null);

  useEffect(() => {
    if (!location) return;
    const locationChanged = location !== prevLocationRef.current;
    prevLocationRef.current = location;

    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(
      () => fetchIsochrone(location.lat, location.lng, transitTime, walkTime, lastMileMode),
      locationChanged ? 0 : 400,
    );
    return () => { if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current); };
  }, [location, transitTime, walkTime, lastMileMode, fetchIsochrone]);

  // Show / hide ferry warning based on whether location is outside Østlandet
  useEffect(() => {
    if (!location || !isOutsideOstlandet(location.lat, location.lng)) {
      dismissFerry();
      return;
    }
    // Cancel any in-progress leave animation and show fresh
    if (ferryLeaveTimer.current) clearTimeout(ferryLeaveTimer.current);
    if (ferryAutoTimer.current) clearTimeout(ferryAutoTimer.current);
    setFerryWarning(true);
    setFerryLeaving(false);
    ferryAutoTimer.current = setTimeout(dismissFerry, 8000);
    return () => {
      if (ferryAutoTimer.current) clearTimeout(ferryAutoTimer.current);
    };
  }, [location, dismissFerry]);

  const handleViewChange = useCallback((lat: number, lng: number) => {
    getNearbyStops(lat, lng).then(setStops).catch(console.error);
  }, []);

  const handleMapClick = (lat: number, lng: number) =>
    setLocation({ lat, lng, name: "" });

  return (
    <main className="fixed inset-x-0 top-0 overflow-hidden" style={{ height: "var(--app-height, 100dvh)" }}>
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

      {loadingVisible && (
        <div
          className={`absolute inset-0 bg-white/20 backdrop-blur-[2px] z-[100] flex items-center justify-center ${
            loadingLeaving
              ? "animate-out fade-out duration-300"
              : "animate-in fade-in duration-200"
          }`}
        >
          <div
            className={`bg-white p-5 rounded-2xl shadow-2xl flex items-center gap-3 ${
              loadingLeaving
                ? "animate-out fade-out zoom-out-75 duration-300"
                : "animate-in fade-in zoom-in-75 duration-200"
            }`}
          >
            <div className="w-5 h-5 border-3 border-ink-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-medium text-ink-primary text-sm">Beregner reisetid...</span>
          </div>
        </div>
      )}

      {ferryWarning && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-[200] w-full max-w-sm px-4 duration-350 ${
            ferryLeaving
              ? "animate-out fade-out slide-out-to-bottom-4"
              : "animate-in fade-in slide-in-from-bottom-4"
          }`}
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
        >
          <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl px-4 py-3 flex items-start gap-3 border border-ink-primary/10">
            <span className="text-base mt-px shrink-0">⛴️</span>
            <p className="text-xs text-ink-primary/80 leading-relaxed">
              Fergeberegninger i denne POC-en er kun kalibrert for Oslofjorden.
              Resultater i dette området kan avvike.
            </p>
            <button
              onClick={dismissFerry}
              className="shrink-0 text-ink-primary/30 hover:text-ink-primary/60 transition-colors text-lg leading-none -mt-0.5"
              aria-label="Lukk"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
