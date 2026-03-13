"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface MapViewProps {
  center?: { lat: number; lng: number };
  isochrone?: any;
  onMapClick?: (lat: number, lng: number) => void;
}

export function MapView({ center, isochrone, onMapClick }: MapViewProps) {
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

      map.current?.addSource("isochrone", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.current?.addLayer({
        id: "isochrone-fill",
        type: "fill",
        source: "isochrone",
        paint: {
          "fill-color": "#2A3066",
          "fill-opacity": 0.15,
        },
      });

      map.current?.addLayer({
        id: "isochrone-outline",
        type: "line",
        source: "isochrone",
        paint: {
          "line-color": "#272D60",
          "line-width": 3,
          "line-opacity": 0.4,
        },
      });
    });

    // Click on map to place pin
    map.current.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      createMarker(lng, lat);
      if (onMapClickRef.current) {
        onMapClickRef.current(lat, lng);
      }
    });

    return () => map.current?.remove();
  }, [createMarker]);

  // Update marker when center changes from search
  useEffect(() => {
    if (!map.current || !center) return;

    map.current.flyTo({
      center: [center.lng, center.lat],
      zoom: 13,
      essential: true,
    });

    createMarker(center.lng, center.lat);
  }, [center, createMarker]);

  useEffect(() => {
    if (!map.current || !mapLoaded.current || !isochrone) return;

    const source = map.current.getSource("isochrone") as maplibre.GeoJSONSource;
    if (!source) return;

    source.setData(isochrone);

    const bounds = new maplibre.LngLatBounds();
    const features = isochrone.features;
    if (features && features.length > 0) {
      for (const feature of features) {
        const geometry = feature.geometry;
        if (geometry.type === "Polygon") {
          for (const ring of geometry.coordinates) {
            for (const coord of ring) {
              bounds.extend(coord as [number, number]);
            }
          }
        } else if (geometry.type === "MultiPolygon") {
          for (const polygon of geometry.coordinates) {
            for (const ring of polygon) {
              for (const coord of ring) {
                bounds.extend(coord as [number, number]);
              }
            }
          }
        }
      }
      if (!bounds.isEmpty()) {
        map.current.fitBounds(bounds, { padding: 80 });
      }
    }
  }, [isochrone]);

  return (
    <div ref={mapContainer} className="w-full h-screen" />
  );
}
