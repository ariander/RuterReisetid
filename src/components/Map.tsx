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

function stopColor(mode: string) {
  return STOP_COLORS[mode] ?? "#888888";
}

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

    // Rasterise an SVG URL to ImageData via an offscreen <canvas>
    function svgToImageData(url: string, size: number): Promise<ImageData> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, size, size);
          resolve(ctx.getImageData(0, 0, size, size));
        };
        img.onerror = reject;
        img.src = url;
      });
    }

    map.current.on("load", async () => {
      mapLoaded.current = true;

      // Load transport mode icons — rasterised from SVG at 24×24
      const modeIcons: [string, string][] = [
        ["icon-metro", "/icons/metro.svg"],
        ["icon-tram",  "/icons/tram.svg"],
        ["icon-bus",   "/icons/bus.svg"],
        ["icon-train", "/icons/train.svg"],
        ["icon-boat",  "/icons/boat.svg"],
      ];
      await Promise.all(
        modeIcons.map(([id, url]) =>
          svgToImageData(url, 24)
            .then((imgData) => {
              if (map.current && !map.current.hasImage(id)) map.current.addImage(id, imgData);
            })
            .catch(() => {})
        )
      );

      // Isochrone layers
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

      // Stops source with clustering
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

      // Individual stop — drop shadow
      map.current?.addLayer({
        id: "stops-shadow",
        type: "circle",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 16,
          "circle-color": "#000000",
          "circle-opacity": 0.30,
          "circle-translate": [0, 3],
          "circle-blur": 0.8,
        },
      });
      // Individual stop — colored circle by mode
      map.current?.addLayer({
        id: "stops-dot",
        type: "circle",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 11,
          "circle-color": [
            "match", ["get", "mode"],
            "metro",  STOP_COLORS.metro,
            "tram",   STOP_COLORS.tram,
            "bus",    STOP_COLORS.bus,
            "coach",  STOP_COLORS.coach,
            "water",  STOP_COLORS.water,
            "rail",   STOP_COLORS.rail,
            "#757575",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      // Individual stop — mode icon (white SVG)
      map.current?.addLayer({
        id: "stops-icon",
        type: "symbol",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": [
            "match", ["get", "mode"],
            "metro", "icon-metro",
            "tram",  "icon-tram",
            "bus",   "icon-bus",
            "coach", "icon-bus",
            "rail",  "icon-train",
            "water", "icon-boat",
            "icon-bus",
          ],
          "icon-size": 0.7,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      // Name labels — only at zoom >= 15, only individual stops
      map.current?.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        minzoom: 15,
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

    const bounds = new maplibre.LngLatBounds();
    for (const feature of isochrone.features ?? []) {
      const coords = feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates.flat(1)
        : feature.geometry.coordinates.flat(2);
      for (const coord of coords) bounds.extend(coord as [number, number]);
    }
    if (!bounds.isEmpty()) map.current.fitBounds(bounds, { padding: 80 });
  }, [isochrone]);

  // Update stops layer
  useEffect(() => {
    if (!map.current || !mapLoaded.current) return;
    const source = map.current.getSource("stops") as maplibre.GeoJSONSource;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: (stops ?? []).map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { name: s.name, mode: s.mode },
      })),
    });
  }, [stops]);

  return <div ref={mapContainer} className="w-full h-screen" />;
}
