// src/components/MultiRouteMap.tsx
//
// SUC Multi-Route Map — Unified Event + Route Camera
// - All routes for the active event are loaded as a faint underlay
// - Selected route is drawn on top in neon
// - Camera auto-fits to the event on event change
// - Camera auto-fits to the selected route on route change
// - Optional live GPS dot when enabled
// - Route playback dot along selected route when enabled

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
  isLiveGpsOn: boolean;
  playbackProgress: number; // 0–1
  isPlaybackOn: boolean;
}

export default function MultiRouteMap({
  event,
  selectedRoute,
  isLiveGpsOn,
  playbackProgress,
  isPlaybackOn,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);

  // Cache of the currently selected route’s coordinates for playback
  const playbackCoordsRef = useRef<[number, number][]>([]);

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
      center: [-121.48, 38.58],
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
  //    Also populate playbackCoordsRef for the playback engine.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const PLAYBACK_SRC_ID = "route-playback";
    const PLAYBACK_LAYER_ID = "route-playback-layer";

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

      // Also clear playback state if route changes
      if (map.getLayer(PLAYBACK_LAYER_ID)) map.removeLayer(PLAYBACK_LAYER_ID);
      if (map.getSource(PLAYBACK_SRC_ID)) map.removeSource(PLAYBACK_SRC_ID);
      playbackCoordsRef.current = [];

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

      // Extract coords for start/finish + camera bounds + playback
      const coords = geo.features
        .filter((f) => f.geometry?.type === "LineString")
        .flatMap(
          (f) => (f.geometry as any).coordinates as [number, number][]
        );

      if (coords.length === 0) return;

      // Cache for playback
      playbackCoordsRef.current = coords;

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

  // 4. LIVE GPS DOT (optional, user-controlled)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const SRC_ID = "user-location";
    const LAYER_ID = "user-location-layer";

    const cleanupLayerAndSource = () => {
      const m = mapRef.current;
      if (!m) return;
      if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID);
      if (m.getSource(SRC_ID)) m.removeSource(SRC_ID);
    };

    // If turning OFF: clear watch + remove layer/source
    if (!isLiveGpsOn) {
      if (gpsWatchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      return withStyleLoaded(map, () => {
        cleanupLayerAndSource();
      });
    }

    // If turning ON: start watching position
    if (!("geolocation" in navigator)) {
      console.warn("[SUC] Geolocation not supported in this browser.");
      return;
    }

    const updatePosition = (lng: number, lat: number) => {
      const pointFeature: Feature<Geometry, GeoJsonProperties> = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {},
      };

      const data: FeatureCollection = {
        type: "FeatureCollection",
        features: [pointFeature],
      };

      withStyleLoaded(map, () => {
        const existingSource = map.getSource(SRC_ID) as
          | maplibregl.GeoJSONSource
          | undefined;

        if (existingSource) {
          existingSource.setData(data);
        } else {
          map.addSource(SRC_ID, {
            type: "geojson",
            data,
          });

          map.addLayer({
            id: LAYER_ID,
            type: "circle",
            source: SRC_ID,
            paint: {
              "circle-radius": 6,
              "circle-color": "#5bc0ff",
              "circle-opacity": 0.9,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-opacity": 0.95,
            },
          });
        }

        // Center / follow the GPS dot
        const currentZoom = map.getZoom();
        map.easeTo({
          center: [lng, lat],
          zoom: currentZoom < 13 ? 13 : currentZoom,
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          duration: 600,
        });
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        updatePosition(longitude, latitude);
      },
      (err) => {
        console.warn("[SUC] Error watching position:", err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      }
    );

    gpsWatchIdRef.current = watchId;

    // Cleanup when effect re-runs or component unmounts
    return () => {
      if (gpsWatchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      withStyleLoaded(map, () => {
        cleanupLayerAndSource();
      });
    };
  }, [isLiveGpsOn]);

  // 5. ROUTE PLAYBACK DOT (selected route)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const SRC_ID = "route-playback";
    const LAYER_ID = "route-playback-layer";

    const coords = playbackCoordsRef.current;
    if (!selectedRoute || coords.length < 2) {
      // If nothing to draw, clean up
      return withStyleLoaded(map, () => {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
      });
    }

    // Clamp playbackProgress for safety
    const clamped = Math.max(0, Math.min(1, playbackProgress));
    const maxIndex = coords.length - 1;
    const scaled = clamped * maxIndex;
    const idx = Math.floor(scaled);
    const t = scaled - idx;

    const start = coords[idx];
    const end = coords[Math.min(idx + 1, maxIndex)];

    // Guard against anything weird
    if (!start || !end) {
      return;
    }

    const lng = start[0] + (end[0] - start[0]) * t;
    const lat = start[1] + (end[1] - start[1]) * t;

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }

    const pointFeature: Feature<Geometry, GeoJsonProperties> = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
      properties: {},
    };

    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [pointFeature],
    };

    return withStyleLoaded(map, () => {
      const existing = map.getSource(SRC_ID) as
        | maplibregl.GeoJSONSource
        | undefined;

      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(SRC_ID, {
          type: "geojson",
          data,
        });

        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SRC_ID,
          paint: {
            "circle-radius": 5.5,
            "circle-color": "#ffe76a",
            "circle-opacity": 0.95,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.95,
          },
        });
      }

      // Follow the playback dot while playing
      if (isPlaybackOn) {
        const currentZoom = map.getZoom();
        map.easeTo({
          center: [lng, lat],
          zoom: currentZoom < 13 ? 13 : currentZoom,
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          duration: 350,
        });
      }
    });
  }, [selectedRoute, playbackProgress, isPlaybackOn]);

  return <div ref={containerRef} className="suc-map-inner" />;
}
