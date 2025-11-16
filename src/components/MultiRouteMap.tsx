// src/components/MultiRouteMap.tsx

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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------
  // 1. Initialize map once
  // -----------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Base MapLibre demo style
      style: "https://demotiles.maplibre.org/style.json",
      center: [-122.5, 37.7],
      zoom: 9,
      attributionControl: false, // we'll add a compact control manually
    });

    // Compact attribution: small "i" icon that expands on click, top-right
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "top-right"
    );

    // When the base style has finished loading, add satellite + topo overlays
    map.on("load", () => {
      // --- SATELLITE BASE (ESRI World Imagery) ---
      if (!map.getSource("esri-satellite")) {
        map.addSource("esri-satellite", {
          type: "raster",
          tiles: [
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          maxzoom: 19,
        });

        map.addLayer({
          id: "esri-satellite",
          type: "raster",
          source: "esri-satellite",
          paint: {
            // Dark, desaturated imagery so neon routes pop
            "raster-saturation": -0.7,
            "raster-brightness-min": 0.15,
            "raster-brightness-max": 0.8,
            "raster-contrast": 0.25,
            "raster-opacity": 1.0,
          },
        });
      }

      // --- SIMPLE TOPO OVERLAY (OpenTopoMap) ---
      if (!map.getSource("opentopo")) {
        map.addSource("opentopo", {
          type: "raster",
          tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 17,
        });

        map.addLayer({
          id: "opentopo",
          type: "raster",
          source: "opentopo",
          paint: {
            "raster-opacity": 0.35,
            "raster-contrast": 0.2,
          },
        });
      }

      // --- Darken the vector background a bit, if present ---
      const style = map.getStyle();
      const bgLayer = (style.layers || []).find(
        (l: any) => l.type === "background"
      );
      if (bgLayer) {
        try {
          map.setPaintProperty(bgLayer.id, "background-color", "#020308");
        } catch {
          // ignore if we can't set it
        }
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Helper: ensure style is loaded before mutating layers/sources
  function withStyleLoaded(map: maplibregl.Map, fn: () => void) {
    if (map.isStyleLoaded()) {
      fn();
      return () => {};
    }

    const handler = () => {
      fn();
    };

    map.once("load", handler);
    return () => {
      map.off("load", handler);
    };
  }

  // -----------------------------------------------------
  // 2. All routes: faint gray underlay
  // -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !event) return;

    return withStyleLoaded(map, () => {
      const BASE_SRC = "all-routes";
      const BASE_LAYER = "all-routes-layer";

      if (map.getLayer(BASE_LAYER)) map.removeLayer(BASE_LAYER);
      if (map.getSource(BASE_SRC)) map.removeSource(BASE_SRC);

      const features: Feature<Geometry, GeoJsonProperties>[] = [];

      event.routes.forEach((route) => {
        if (!route.geojson) return;
        route.geojson.features.forEach((f) => {
          features.push(f as Feature<Geometry, GeoJsonProperties>);
        });
      });

      const merged: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features,
      };

      map.addSource(BASE_SRC, {
        type: "geojson",
        data: merged,
      });

      map.addLayer({
        id: BASE_LAYER,
        type: "line",
        source: BASE_SRC,
        paint: {
          "line-color": "#dddddd",
          "line-opacity": 0.25,
          "line-width": 3,
        },
      });

      // Fit bounds to all routes
      const bounds = new maplibregl.LngLatBounds();
      features.forEach((f) => {
        if (f.geometry?.type === "LineString") {
          f.geometry.coordinates.forEach((c) => {
            bounds.extend(c as [number, number]);
          });
        }
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40 });
      }
    });
  }, [event]);

  // -----------------------------------------------------
  // 3. Selected route: neon glow highlight
  // -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    return withStyleLoaded(map, () => {
      const SRC = "selected-route";
      const LAYER_GLOW = "selected-route-glow";
      const LAYER_LINE = "selected-route-line";

      // Remove previous highlight layers/sources
      [LAYER_GLOW, LAYER_LINE].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SRC)) map.removeSource(SRC);

      if (!selectedRoute || !selectedRoute.geojson) return;

      map.addSource(SRC, {
        type: "geojson",
        data: selectedRoute.geojson as FeatureCollection<
          Geometry,
          GeoJsonProperties
        >,
      });

      // Soft glow layer
      map.addLayer({
        id: LAYER_GLOW,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 12,
          "line-opacity": 0.25,
          "line-blur": 2,
        },
      });

      // Crisp neon line
      map.addLayer({
        id: LAYER_LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 7,
          "line-opacity": 1.0,
        },
      });

      // Fit bounds to selected route
      const bounds = new maplibregl.LngLatBounds();
      selectedRoute.geojson.features.forEach((f) => {
        if (f.geometry.type === "LineString") {
          f.geometry.coordinates.forEach((c) => {
            bounds.extend(c as [number, number]);
          });
        }
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60 });
      }
    });
  }, [selectedRoute]);

  // -----------------------------------------------------
  // 4. Container
  // -----------------------------------------------------
  return <div ref={containerRef} className="suc-map-inner" />;
}
