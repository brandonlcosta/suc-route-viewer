// src/components/MultiRouteMap.tsx
//
// Map for a single SUC event; shows all routes as a gray underlay and the
// currently selected route as a neon line with start/finish POI markers.

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

  // Ensure style is loaded before mutating layers/sources
  function withStyleLoaded(map: maplibregl.Map, fn: () => void) {
    if (map.isStyleLoaded()) {
      fn();
      return () => {};
    }
    const handler = () => fn();
    map.once("load", handler);
    return () => map.off("load", handler);
  }

  // 1. Initialize map once
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-122.5, 37.7],
      zoom: 9,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-left",
    );
    map.on("load", () => {
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
            "raster-saturation": -0.7,
            "raster-brightness-min": 0.1,
            "raster-brightness-max": 0.8,
            "raster-contrast": 0.25,
            "raster-opacity": 1.0,
          },
        });
      }
      if (!map.getSource("opentopo")) {
        map.addSource("opentopo", {
          type: "raster",
          tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 17,
        });
        map.addLayer({
          id: "opentopo-layer",
          type: "raster",
          source: "opentopo",
          paint: { "raster-opacity": 0.35 },
        });
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. All routes: faint gray underlay (hidden when a route selected)
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
      if (features.length === 0) return;

      const merged: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features,
      };
      map.addSource(BASE_SRC, { type: "geojson", data: merged });
      map.addLayer({
        id: BASE_LAYER,
        type: "line",
        source: BASE_SRC,
        paint: {
          "line-color": "#d0d0d0",
          "line-width": 2,
          "line-opacity": selectedRoute ? 0.0 : 0.35,
        },
      });

      // Fit to all event routes when nothing is selected
      if (!selectedRoute) {
        const bounds = new maplibregl.LngLatBounds();
        features.forEach((f) => {
          if (f.geometry?.type === "LineString") {
            (f.geometry.coordinates as [number, number][]).forEach((c) => {
              bounds.extend(c);
            });
          }
        });
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40 });
      }
    });
  }, [event, selectedRoute]);

  // 3. Selected route: highlight + start/finish POIs
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return withStyleLoaded(map, () => {
      const SRC = "selected-route";
      const SRC_POI = "selected-route-poi";
      const LAYER_GLOW = "selected-route-glow";
      const LAYER_LINE = "selected-route-line";
      const LAYER_POI = "selected-route-poi-layer";
      const BASE_LAYER = "all-routes-layer";

      [LAYER_GLOW, LAYER_LINE, LAYER_POI].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [SRC, SRC_POI].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });

      // Only one route visible at a time: hide underlay when selected
      if (map.getLayer(BASE_LAYER)) {
        map.setLayoutProperty(
          BASE_LAYER,
          "visibility",
          selectedRoute && selectedRoute.geojson ? "none" : "visible",
        );
      }
      if (!selectedRoute || !selectedRoute.geojson) return;

      const routeData =
        selectedRoute.geojson as FeatureCollection<
          Geometry,
          GeoJsonProperties
        >;
      map.addSource(SRC, { type: "geojson", data: routeData });

      // Softer, thinner glow
      map.addLayer({
        id: LAYER_GLOW,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 9,
          "line-opacity": 0.2,
          "line-blur": 2,
        },
      });
      // Main line, less chunky / intense
      map.addLayer({
        id: LAYER_LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      // Start / finish markers
      const lineFeatures = routeData.features.filter(
        (f) => f.geometry && f.geometry.type === "LineString",
      );
      if (lineFeatures.length > 0) {
        const firstCoords = (lineFeatures[0].geometry as any).coordinates;
        const lastCoords =
          (lineFeatures[lineFeatures.length - 1].geometry as any).coordinates;
        const start =
          Array.isArray(firstCoords) && firstCoords.length > 0
            ? firstCoords[0]
            : null;
        const finish =
          Array.isArray(lastCoords) && lastCoords.length > 0
            ? lastCoords[lastCoords.length - 1]
            : null;

        const poiFeatures: Feature<Geometry, GeoJsonProperties>[] = [];
        if (start) {
          poiFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: start as [number, number] },
            properties: { kind: "start" },
          });
        }
        if (finish) {
          poiFeatures.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: finish as [number, number],
            },
            properties: { kind: "finish" },
          });
        }

        if (poiFeatures.length > 0) {
          const poiCollection: FeatureCollection<
            Geometry,
            GeoJsonProperties
          > = {
            type: "FeatureCollection",
            features: poiFeatures,
          };
          map.addSource(SRC_POI, { type: "geojson", data: poiCollection });
          map.addLayer({
            id: LAYER_POI,
            type: "circle",
            source: SRC_POI,
            paint: {
              "circle-radius": 5,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-color": [
                "case",
                ["==", ["get", "kind"], "finish"],
                "#ff3366", // finish
                "#00ffcc", // start
              ],
            },
          });
        }
      }

      // Fit map to the selected route
      const bounds = new maplibregl.LngLatBounds();
      routeData.features.forEach((f) => {
        if (f.geometry?.type === "LineString") {
          (f.geometry.coordinates as [number, number][]).forEach((c) => {
            bounds.extend(c);
          });
        }
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60 });
    });
  }, [selectedRoute]);

  return <div ref={containerRef} className="suc-map-inner" />;
}
