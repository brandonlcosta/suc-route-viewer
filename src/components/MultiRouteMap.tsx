// src/components/MultiRouteMap.tsx
//
// SUC Multi-Route Map — Unified Event + Route Camera
// - All routes for the active event are loaded as a faint underlay
// - Selected route is drawn on top in neon
// - Camera auto-fits to the event on event change
// - Camera auto-fits to the selected route on route change

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { SUCEvent, SUCRoute } from "../data/loadEvents";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
} from "geojson";

interface Props {
  event: SUCEvent | null;
  selectedRoute: SUCRoute | null;
}

export default function MultiRouteMap({ event, selectedRoute }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  function withStyleLoaded(map: maplibregl.Map, fn: () => void) {
    if (map.isStyleLoaded()) {
      fn();
      return () => {};
    }
    const handler = () => fn();
    map.once("styledata", handler);
    return () => map.off("styledata", handler);
  }

  // 1. INITIAL MAP CREATION
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "/dark-tactical-terrain.json",
      center: [-122.5, 37.7],
      zoom: 11,
      pitch: 35,
      bearing: -28,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-left"
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. BASE ROUTE UNDERLAY FOR ACTIVE EVENT + FIT TO EVENT
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !event) return;

    return withStyleLoaded(map, () => {
      const SRC = "routes-base";
      const LAYER = "routes-base-line";

      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SRC)) map.removeSource(SRC);

      const features: Feature<Geometry, GeoJsonProperties>[] = [];

      event.routes.forEach((r) => {
        if (!r.geojson) return;
        r.geojson.features.forEach((f) =>
          features.push(f as Feature<Geometry, GeoJsonProperties>)
        );
      });

      if (features.length === 0) return;

      const merged: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features,
      };

      map.addSource(SRC, { type: "geojson", data: merged });

      map.addLayer({
        id: LAYER,
        type: "line",
        source: SRC,
        paint: {
          "line-color": "#7a7a96",
          "line-width": 1.4,
          "line-opacity": 0.35,
        },
      });

      // Fit camera to all routes in this event
      const bounds = new maplibregl.LngLatBounds();
      merged.features.forEach((f) => {
        if (f.geometry?.type === "LineString") {
          (f.geometry.coordinates as [number, number][]).forEach((c) =>
            bounds.extend(c)
          );
        }
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 70,
          maxZoom: 13,
          duration: 900,
        });
      }
    });
  }, [event]);

  // 3. SELECTED ROUTE HIGHLIGHT + FIT TO ROUTE
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    return withStyleLoaded(map, () => {
      const SRC = "route-selected";
      const SRC_POI = "route-poi";
      const GLOW = "route-glow";
      const LINE = "route-line";
      const POI = "route-poi-layer";

      // Cleanup previous selected route layers/sources
      [GLOW, LINE, POI].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [SRC, SRC_POI].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });

      if (!selectedRoute || !selectedRoute.geojson) return;

      const geo =
        selectedRoute.geojson as FeatureCollection<
          Geometry,
          GeoJsonProperties
        >;

      map.addSource(SRC, { type: "geojson", data: geo });

      // Glow layer
      map.addLayer({
        id: GLOW,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 10,
          "line-opacity": 0.22,
          "line-blur": 2.6,
        },
      });

      // Crisp neon center line
      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 4.2,
          "line-opacity": 0.95,
        },
      });

      // Extract coords for start/finish + camera bounds
      const coords = geo.features
        .filter((f) => f.geometry?.type === "LineString")
        .flatMap(
          (f) => (f.geometry as any).coordinates as [number, number][]
        );

      if (coords.length === 0) return;

      // Start / finish POIs
      map.addSource(SRC_POI, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "start" },
              geometry: { type: "Point", coordinates: coords[0] },
            },
            {
              type: "Feature",
              properties: { kind: "finish" },
              geometry: {
                type: "Point",
                coordinates: coords[coords.length - 1],
              },
            },
          ],
        },
      });

      map.addLayer({
        id: POI,
        type: "circle",
        source: SRC_POI,
        paint: {
          "circle-radius": 5.5,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-color": [
            "case",
            ["==", ["get", "kind"], "finish"],
            "#ff3366",
            "#00ffcc",
          ],
        },
      });

      // Fit camera to the selected route
      const rbounds = new maplibregl.LngLatBounds();
      coords.forEach((c) => rbounds.extend(c));

      if (!rbounds.isEmpty()) {
        map.fitBounds(rbounds, {
          padding: 70,
          maxZoom: 14,
          duration: 700,
        });
      }
    });
  }, [selectedRoute]);

  return <div ref={containerRef} className="suc-map-inner" />;
}
