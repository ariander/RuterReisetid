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
  const [transitTime, setTransitTime] = useState(15);
  const [walkTime, setWalkTime] = useState(10);
  const [isochrone, setIsochrone] = useState<any>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);
  const [geoActive, setGeoActive] = useState(false);
  const geoWatchId = useRef<number | null>(null);

  // Loading overlay visual state (decoupled from `loading` so exit can animate)
  const [loadingVisible, setLoadingVisible] = useState(false);
  const [loadingLeaving, setLoadingLeaving] = useState(false);
  const loadingShowRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Info popup state
  const [infoOpen, setInfoOpen] = useState(false);

  // Ferry warning toast state
  const [ferryWarning, setFerryWarning] = useState(false);
  const [ferryLeaving, setFerryLeaving] = useState(false);
  const ferryAutoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ferryLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleGeolocate = useCallback(() => {
    if (geoActive) {
      // Turn off geolocation
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
        geoWatchId.current = null;
      }
      setGeoActive(false);
      return;
    }

    if (!navigator.geolocation) {
      console.error("Geolocation not supported");
      return;
    }

    setGeoActive(true);

    // Get position once immediately
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: "Min posisjon",
        });
      },
      (err) => {
        console.error("Geolocation error:", err);
        setGeoActive(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [geoActive]);

  // Clean up geolocation watch on unmount
  useEffect(() => {
    return () => {
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
      }
    };
  }, []);

  // If user manually picks a location (map click or search), deactivate geo
  const setLocationAndDeactivateGeo = useCallback(
    (loc: { lat: number; lng: number; name: string }) => {
      if (loc.name !== "Min posisjon") {
        if (geoWatchId.current !== null) {
          navigator.geolocation.clearWatch(geoWatchId.current);
          geoWatchId.current = null;
        }
        setGeoActive(false);
      }
      setLocation(loc);
    },
    []
  );

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

  // ── Accumulated stops cache ─────────────────────────────────────
  // Stops are merged into a Map keyed by ID so panning never loses
  // previously-loaded stops.  The fetch radius (3 km) is larger than
  // the viewport to prefetch surrounding areas.
  const stopsCacheRef = useRef<Map<string, Stop>>(new Map());

  const handleViewChange = useCallback((lat: number, lng: number) => {
    getNearbyStops(lat, lng, 8000).then((newStops) => {
      const cache = stopsCacheRef.current;
      let changed = false;
      for (const s of newStops) {
        if (!cache.has(s.id)) {
          cache.set(s.id, s);
          changed = true;
        }
      }
      if (changed) {
        setStops(Array.from(cache.values()));
      }
    }).catch(console.error);
  }, []);

  const handleMapClick = (lat: number, lng: number) =>
    setLocationAndDeactivateGeo({ lat, lng, name: "" });

  return (
    <main className="fixed inset-0">
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[110] w-full max-w-md px-4"
        style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg px-3 py-2.5 z-index-99">
          <div className="flex items-center gap-3 pl-2">
            <Image src="/reisetid-logo.svg" alt="Reisetid" width={96} height={96} className="shrink-0" />
            <SearchBar onSelect={setLocationAndDeactivateGeo} />
            <button
              onClick={handleGeolocate}
              className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
                geoActive
                  ? "bg-[#091AA9]/10"
                  : "hover:bg-ink-primary/5 active:scale-95"
              }`}
              aria-label="Min posisjon"
            >
              <img
                src="/position.svg"
                alt=""
                width={20}
                height={20}
                className={`transition-all duration-200 ${
                  geoActive ? "opacity-100 scale-110" : "opacity-40 grayscale"
                }`}
              />
            </button>
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
      {/* ── Info popup (bottom-left) ─────────────────────────────────── */}
      <div
        className="fixed z-[120]"
        style={{
          left: "calc(env(safe-area-inset-left, 0px) + 1rem)",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
        }}
      >
        {/* Expanded info box — slides in from left */}
        <div
          className={`absolute bottom-0 w-72 mb-12 ${
            infoOpen
              ? "pointer-events-auto"
              : "pointer-events-none"
          }`}
          style={{
            left: infoOpen ? "0px" : "-320px",
            transition: "left 250ms cubic-bezier(.4,0,.2,1)",
          }}
        >
          <div className="bg-white/85 backdrop-blur-xl rounded-2xl shadow-xl border border-ink-primary/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink-primary text-sm">Om denne POC-en</h3>
              <button
                onClick={() => setInfoOpen(false)}
                className="text-ink-primary/30 hover:text-ink-primary/60 transition-colors text-lg leading-none"
                aria-label="Lukk"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-ink-primary/70 leading-relaxed mb-3">
              Ruter Reisetid er en proof-of-concept laget av{" "}
              <a href="mailto:arild.andersen@tetdigital.no" className="text-[#091AA9] no-underline hover:underline underline-offset-2 transition-all duration-200">Arild Andersen</a> i{" "}
              <a href="https://tetdigital.no" target="_blank" rel="noopener noreferrer" className="text-[#091AA9] no-underline hover:underline underline-offset-2 transition-all duration-200">Tet Digital</a>. Appen viser isokron-kart, altså
              hvor langt du kan reise med kollektivtransport innen en gitt tid.
            </p>

            <h4 className="font-medium text-ink-primary text-xs mb-1.5">API-er</h4>
            <ul className="text-xs text-ink-primary/70 leading-relaxed mb-3 space-y-0.5">
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span><strong>Targomo</strong> –  isokronberegning (polygon)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span><strong>Entur</strong> – holdeplasser, fergeruter og stedsøk</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span><strong>MapLibre GL</strong> – kartvisning (OpenMapTiles)</span>
              </li>
            </ul>

            <h4 className="font-medium text-ink-primary text-xs mb-1.5">Forutsetninger</h4>
            <ul className="text-xs text-ink-primary/70 leading-relaxed space-y-0.5">
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>Avgang neste ukedag kl. 16:00 (ettermiddagsrush)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>45 min. avgangsvindu (beste forbindelse innen vinduet)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>Ganghastighet: ~5 km/t (Targomo standard)</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>Sparkesykkel modellert som 3× ganghastighet</span>
              </li>
              <li className="flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>Fergeberegning kun kalibrert for Oslofjorden</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setInfoOpen((o) => !o)}
          className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 ${
            infoOpen
              ? "bg-[#313663] scale-95"
              : "bg-white/85 backdrop-blur-xl hover:bg-white active:scale-95"
          }`}
          aria-label="POC info"
        >
          <img
            src="/info.svg"
            alt=""
            width={20}
            height={20}
            className={`transition-all duration-200 ${
              infoOpen ? "brightness-0 invert" : "opacity-60"
            }`}
          />
        </button>
      </div>
    </main>
  );
}
