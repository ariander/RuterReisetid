"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Stop } from "@/lib/entur-stops";

interface MapViewProps {
  center?: { lat: number; lng: number };
  isochrone?: any;
  stops?: Stop[];
  onMapClick?: (lat: number, lng: number) => void;
  onViewChange?: (lat: number, lng: number) => void;
}

const STOP_COLORS: Record<string, string> = {
  metro:  "#EC700C",
  tram:   "#0B91EF",
  bus:    "#E60000",
  coach:  "#75A300",
  water:  "#682C88",
  rail:   "#003087",
};

/** Badge offset (image-px) between adjacent mode squares — snug side by side */
const BADGE_OFFSET = 22;

export function MapView({ center, isochrone, stops, onMapClick, onViewChange }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibre.Map | null>(null);
  const marker = useRef<maplibre.Marker | null>(null);
  const mapLoaded = useRef(false);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const createMarker = useCallback((lng: number, lat: number) => {
    if (!map.current) return;
    if (marker.current) marker.current.remove();

    const el = document.createElement("div");
    el.style.cursor = "grab";
    el.innerHTML = `<img src="/pin.svg" width="40" height="40" alt="pin" style="transform: translateY(-50%);" />`;

    marker.current = new maplibre.Marker({ element: el, draggable: true })
      .setLngLat([lng, lat])
      .addTo(map.current);

    marker.current.on("dragend", () => {
      const lngLat = marker.current?.getLngLat();
      if (lngLat && onMapClickRef.current) {
        onMapClickRef.current(lngLat.lat, lngLat.lng);
      }
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    let destroyed = false;

    // Fetch Voyager style, swap glyphs to our proxy, then initialise the map
    fetch("https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json")
      .then((r) => r.json())
      .then((voyagerStyle) => {
        if (destroyed || !mapContainer.current) return;

        voyagerStyle.glyphs = "/api/fonts/{fontstack}/{range}.pbf";

        map.current = new maplibre.Map({
          container: mapContainer.current,
          style: voyagerStyle,
          center: [10.7522, 59.9139],
          zoom: 12,
        });

    // Fetch stops based on current map center on load and after panning/zooming
    const fireViewChange = () => {
      const c = map.current?.getCenter();
      if (c) onViewChangeRef.current?.(c.lat, c.lng);
    };

    // ── Image helpers ──────────────────────────────────────────────

    /** Load an <img> from a URL and resolve when ready */
    function loadImg(url: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }

    /**
     * Create a composite "badge" image: coloured rounded square + white SVG icon
     * with built-in drop shadow.
     * Rendered at 2× for retina crispness; logical size = S/2.
     */
    async function createBadge(svgUrl: string, color: string): Promise<ImageData> {
      const S = 56;         // canvas px — extra room for shadow
      const RECT = 40;      // rounded-square side
      const RAD = 10;       // corner radius
      const STROKE = 3;
      const ICON = 24;      // inner icon draw-size

      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d")!;

      const x = (S - RECT) / 2;
      const y = (S - RECT) / 2 - 1;  // shift up slightly to make room for shadow below

      // Drop shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.roundRect(x, y, RECT, RECT, RAD);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // Coloured rounded square (re-draw without shadow for crisp edges)
      ctx.beginPath();
      ctx.roundRect(x, y, RECT, RECT, RAD);
      ctx.fillStyle = color;
      ctx.fill();

      // White border
      ctx.beginPath();
      ctx.roundRect(x, y, RECT, RECT, RAD);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = STROKE;
      ctx.stroke();

      // White SVG icon centred inside
      const icon = await loadImg(svgUrl);
      const ix = (S - ICON) / 2;
      const iy = y + (RECT - ICON) / 2;
      ctx.drawImage(icon, ix, iy, ICON, ICON);

      return ctx.getImageData(0, 0, S, S);
    }

    map.current.on("load", async () => {
      mapLoaded.current = true;

      // Force a resize after layout settles — iOS sometimes reads the container
      // height before the viewport is fully calculated, leaving a gap at the bottom.
      requestAnimationFrame(() => map.current?.resize());

      // ── Create composite stop-badge images ───────────────────────
      const badges: [string, string, string][] = [
        ["stop-metro", "/icons/metro.svg", STOP_COLORS.metro],
        ["stop-tram",  "/icons/tram.svg",  STOP_COLORS.tram],
        ["stop-bus",   "/icons/bus.svg",   STOP_COLORS.bus],
        ["stop-coach", "/icons/bus.svg",   STOP_COLORS.coach],
        ["stop-train", "/icons/train.svg", STOP_COLORS.rail],
        ["stop-boat",  "/icons/boat.svg",  STOP_COLORS.water],
      ];
      await Promise.all(
        badges.map(([id, url, color]) =>
          createBadge(url, color)
            .then((imgData) => {
              if (map.current && !map.current.hasImage(id))
                map.current.addImage(id, imgData, { pixelRatio: 2 });
            })
            .catch(() => {})
        )
      );

      // ── Isochrone layers ─────────────────────────────────────────
      map.current?.addSource("isochrone", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.current?.addLayer({
        id: "isochrone-fill",
        type: "fill",
        source: "isochrone",
        paint: { "fill-color": "#07A85A", "fill-opacity": 0.25 },
      });

      // ── Stops source with clustering ─────────────────────────────
      map.current?.addSource("stops", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 40,
      });

      // Cluster bubble
      map.current?.addLayer({
        id: "stops-cluster",
        type: "circle",
        source: "stops",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#272D60",
          "circle-radius": ["step", ["get", "point_count"], 12, 5, 16, 20, 20],
          "circle-opacity": 0.85,
        },
      });
      // Cluster count label
      map.current?.addLayer({
        id: "stops-cluster-count",
        type: "symbol",
        source: "stops",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["TID UI Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // ── Individual stops ─────────────────────────────────────────
      // Composite badge (coloured rounded square + mode icon) — one per mode,
      // shadow is baked into the badge image.
      // offset horizontally so multi-mode stops fan out side-by-side.
      map.current?.addLayer({
        id: "stops-badge",
        type: "symbol",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": [
            "match", ["get", "mode"],
            "metro", "stop-metro",
            "tram",  "stop-tram",
            "bus",   "stop-bus",
            "coach", "stop-coach",
            "rail",  "stop-train",
            "water", "stop-boat",
            "stop-bus",
          ],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          // Offset each badge horizontally:
          // dx = (modeIndex − (modeCount−1)/2) × BADGE_OFFSET
          "icon-offset": [
            "case",
            // ── single mode: centred ──
            ["==", ["get", "modeCount"], 1],
            ["literal", [0, 0]],
            // ── two modes ──
            ["all", ["==", ["get", "modeCount"], 2], ["==", ["get", "modeIndex"], 0]],
            ["literal", [-BADGE_OFFSET / 2, 0]],
            ["all", ["==", ["get", "modeCount"], 2], ["==", ["get", "modeIndex"], 1]],
            ["literal", [BADGE_OFFSET / 2, 0]],
            // ── three modes ──
            ["all", ["==", ["get", "modeCount"], 3], ["==", ["get", "modeIndex"], 0]],
            ["literal", [-BADGE_OFFSET, 0]],
            ["all", ["==", ["get", "modeCount"], 3], ["==", ["get", "modeIndex"], 1]],
            ["literal", [0, 0]],
            ["all", ["==", ["get", "modeCount"], 3], ["==", ["get", "modeIndex"], 2]],
            ["literal", [BADGE_OFFSET, 0]],
            // fallback
            ["literal", [0, 0]],
          ] as any,
          "symbol-sort-key": ["get", "modeIndex"],  // later index drawn on top
        },
      });

      // Name labels — only at zoom ≥ 15, once per stop
      map.current?.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "modeIndex"], 0]],
        minzoom: 13,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["TID UI Regular"],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#333333",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // All sources & layers ready — now trigger the initial viewport fetch
      fireViewChange();
    });

    map.current.on("moveend", () => {
      fireViewChange();
    });

    // Zoom into cluster on click
    map.current.on("click", "stops-cluster", (e) => {
      const features = map.current?.queryRenderedFeatures(e.point, { layers: ["stops-cluster"] });
      if (!features?.length) return;
      const clusterId = features[0].properties?.cluster_id;
      const source = map.current?.getSource("stops") as maplibre.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        if (zoom == null || !map.current) return;
        map.current.easeTo({
          center: (features[0].geometry as any).coordinates as [number, number],
          zoom,
        });
      }).catch(() => {});
      e.originalEvent.stopPropagation();
    });

    // Pointer cursor on clusters
    map.current.on("mouseenter", "stops-cluster", () => {
      if (map.current) map.current.getCanvas().style.cursor = "pointer";
    });
    map.current.on("mouseleave", "stops-cluster", () => {
      if (map.current) map.current.getCanvas().style.cursor = "";
    });

    // General map click → place pin
    map.current.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      createMarker(lng, lat);
      if (onMapClickRef.current) onMapClickRef.current(lat, lng);
    });
      }); // end fetch .then()

    return () => {
      destroyed = true;
      map.current?.remove();
    };
  }, [createMarker]);

  // Move map & marker when center changes
  useEffect(() => {
    if (!map.current || !center) return;
    map.current.flyTo({ center: [center.lng, center.lat], zoom: 13, essential: true });
    createMarker(center.lng, center.lat);
  }, [center, createMarker]);

  // Update isochrone
  useEffect(() => {
    if (!map.current || !mapLoaded.current || !isochrone) return;
    const source = map.current.getSource("isochrone") as maplibre.GeoJSONSource;
    if (!source) return;
    source.setData(isochrone);
  }, [isochrone]);

  // Update stops layer — expand multi-mode stops into one feature per mode
  useEffect(() => {
    if (!map.current || !mapLoaded.current) return;
    const source = map.current.getSource("stops") as maplibre.GeoJSONSource;
    if (!source) return;

    // Cap at 3 modes per stop to keep the badge row manageable
    const MAX_MODES = 3;

    source.setData({
      type: "FeatureCollection",
      features: (stops ?? []).flatMap((s) =>
        s.modes.slice(0, MAX_MODES).map((mode, i, arr) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
          properties: {
            name: s.name,
            mode,
            modeIndex: i,
            modeCount: arr.length,
          },
        }))
      ),
    });
  }, [stops]);

  return (
    <div className="absolute inset-0">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
