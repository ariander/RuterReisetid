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
}

const STOP_COLORS: Record<string, string> = {
  metro:  "#272D60",
  rail:   "#C0392B",
  tram:   "#E87722",
  bus:    "#07A85A",
  water:  "#2980B9",
};

function stopColor(mode: string) {
  return STOP_COLORS[mode] ?? "#888888";
}

export function MapView({ center, isochrone, stops, onMapClick }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibre.Map | null>(null);
  const marker = useRef<maplibre.Marker | null>(null);
  const mapLoaded = useRef(false);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

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

    map.current = new maplibre.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [10.7522, 59.9139],
      zoom: 12,
    });

    map.current.on("load", () => {
      mapLoaded.current = true;

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
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Individual stop — white border ring
      map.current?.addLayer({
        id: "stops-ring",
        type: "circle",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });
      // Individual stop — colored dot by mode
      map.current?.addLayer({
        id: "stops-dot",
        type: "circle",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "match", ["get", "mode"],
            "metro",  STOP_COLORS.metro,
            "rail",   STOP_COLORS.rail,
            "tram",   STOP_COLORS.tram,
            "bus",    STOP_COLORS.bus,
            "water",  STOP_COLORS.water,
            "#888888",
          ],
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
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#272D60",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
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

    return () => map.current?.remove();
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
