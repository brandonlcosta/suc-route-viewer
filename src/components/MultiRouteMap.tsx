// src/components/MultiRouteMap.tsx
//
// SUC Multi-Route Map — Unified Event + Route Camera
// - Permanent "ghost" layer of all SUC routes
// - Active event underlay
// - Selected route neon highlight + POIs
// - Live GPS dot (optional)
// - Playback dot that moves along the selected route

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { SUCEvent, SUCRoute } from "../data/loadEvents";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
} from "geojson";

interface Props {
  event: SUCEvent | null;
  selectedRoute: SUCRoute | null;
  isLiveGpsOn: boolean;
  playbackProgress: number; // 0–1
  isPlaybackOn: boolean;
  permanentRoutesGeoJson: FeatureCollection<LineString> | null;
}

// Map IDs so we don’t typo them all over the place
const ID = {
  permanentSrc: "suc-permanent-routes-source",
  permanentLayer: "suc-permanent-routes-layer",

  baseSrc: "routes-base",
  baseLayer: "routes-base-line",

  selectedSrc: "route-selected",
  selectedGlow: "route-glow",
  selectedLine: "route-line",

  poiSrc: "route-poi",
  poiLayer: "route-poi-layer",

  gpsSrc: "user-location",
  gpsLayer: "user-location-layer",

  playbackSrc: "route-playback",
  playbackLayer: "route-playback-layer",
} as const;

export default function MultiRouteMap({
  event,
  selectedRoute,
  isLiveGpsOn,
  playbackProgress,
  isPlaybackOn,
  permanentRoutesGeoJson,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);

  // Flattened coordinates for the currently selected route (for playback)
  const playbackCoordsRef = useRef<[number, number][]>([]);

  // Utility: run once style is loaded
  function withStyleLoaded(map: maplibregl.Map, fn: () => void) {
    if (map.isStyleLoaded()) {
      fn();
      return () => {};
    }
    const handler = () => fn();
    map.once("styledata", handler);
    return () => map.off("styledata", handler);
  }

  // Utility: add/update a GeoJSON source
  function setGeoJsonSource(
    map: maplibregl.Map,
    sourceId: string,
    data: FeatureCollection
  ) {
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(sourceId, { type: "geojson", data });
    }
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

  // 2. PERMANENT GHOST LAYER — all SUC routes EXCEPT the active event
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !permanentRoutesGeoJson) {
      if (map) {
        if (map.getLayer(ID.permanentLayer)) map.removeLayer(ID.permanentLayer);
        if (map.getSource(ID.permanentSrc)) map.removeSource(ID.permanentSrc);
      }
      return;
    }

    return withStyleLoaded(map, () => {
      let dataToUse: FeatureCollection<LineString> = permanentRoutesGeoJson;

      if (event) {
        const filteredFeatures = permanentRoutesGeoJson.features.filter(
          (f: any) => {
            const props = (f.properties || {}) as { eventId?: string };
            return props.eventId !== event.eventId;
          }
        );

        dataToUse = {
          type: "FeatureCollection",
          features: filteredFeatures,
        };
      }

      if (!dataToUse.features.length) {
        if (map.getLayer(ID.permanentLayer)) map.removeLayer(ID.permanentLayer);
        if (map.getSource(ID.permanentSrc)) map.removeSource(ID.permanentSrc);
        return;
      }

      setGeoJsonSource(map, ID.permanentSrc, dataToUse);

      if (!map.getLayer(ID.permanentLayer)) {
        const layerDefinition = {
          id: ID.permanentLayer,
          type: "line" as const,
          source: ID.permanentSrc,
          paint: {
            "line-color": "#ffffff",
            "line-width": 1,
            "line-opacity": 0.16,
            "line-blur": 0.6,
          },
        };

        map.addLayer(layerDefinition);
      }
    });
  }, [permanentRoutesGeoJson, event?.eventId]);

  // 3. BASE UNDERLAY + SELECTED ROUTE + POIs + BOUNDS (single refresh pass)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    console.log("[SUC] MultiRouteMap refresh:", {
      eventId: event?.eventId,
      selectedRouteId: selectedRoute?.id,
      selectedLabel: selectedRoute?.label,
    });

    return withStyleLoaded(map, () => {
      // Clear all route-specific layers/sources (but NOT permanent ghost layer)
      const layersToRemove = [
        ID.baseLayer,
        ID.selectedGlow,
        ID.selectedLine,
        ID.poiLayer,
        ID.playbackLayer,
      ];
      const sourcesToRemove = [
        ID.baseSrc,
        ID.selectedSrc,
        ID.poiSrc,
        ID.playbackSrc,
      ];

      layersToRemove.forEach((layerId) => {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      });
      sourcesToRemove.forEach((sourceId) => {
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      });
      playbackCoordsRef.current = [];

      if (!event) return;

      // 🔹 1) Base underlay: all routes for this event (gray)
      const baseFeatures: Feature<Geometry, GeoJsonProperties>[] = [];
      event.routes.forEach((route) => {
        const fc = route.geojson;
        if (!fc || !Array.isArray(fc.features)) return;
        fc.features.forEach((f) =>
          baseFeatures.push(f as Feature<Geometry, GeoJsonProperties>)
        );
      });

      if (baseFeatures.length) {
        const mergedBase: FeatureCollection<Geometry, GeoJsonProperties> = {
          type: "FeatureCollection",
          features: baseFeatures,
        };

        map.addSource(ID.baseSrc, { type: "geojson", data: mergedBase });

        map.addLayer({
          id: ID.baseLayer,
          type: "line",
          source: ID.baseSrc,
          paint: {
            "line-color": "#7a7a96",
            "line-width": 1.4,
            "line-opacity": 0.35,
          },
        });
      }

      // 🔹 2) Selected route highlight + POIs
      if (!selectedRoute || !selectedRoute.geojson) return;

      const fc = selectedRoute.geojson;
      const lineFeatures: Feature<Geometry, GeoJsonProperties>[] = [];
      const poiFeatures: Feature<Geometry, GeoJsonProperties>[] = [];

      fc.features.forEach((f) => {
        if (!f.geometry) return;
        if (
          f.geometry.type === "LineString" ||
          f.geometry.type === "MultiLineString"
        ) {
          lineFeatures.push(f as Feature<Geometry, GeoJsonProperties>);
        } else {
          poiFeatures.push(f as Feature<Geometry, GeoJsonProperties>);
        }
      });

      if (!lineFeatures.length) return;

      const mergedLines: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features: lineFeatures,
      };

      map.addSource(ID.selectedSrc, {
        type: "geojson",
        data: mergedLines,
      });

      map.addLayer({
        id: ID.selectedGlow,
        type: "line",
        source: ID.selectedSrc,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 10,
          "line-opacity": 0.22,
          "line-blur": 2.6,
        },
      });

      map.addLayer({
        id: ID.selectedLine,
        type: "line",
        source: ID.selectedSrc,
        paint: {
          "line-color": selectedRoute.color,
          "line-width": 2.4,
          "line-opacity": 0.9,
        },
      });

      if (poiFeatures.length) {
        const poiCollection: FeatureCollection<Geometry, GeoJsonProperties> = {
          type: "FeatureCollection",
          features: poiFeatures,
        };

        map.addSource(ID.poiSrc, {
          type: "geojson",
          data: poiCollection,
        });

        map.addLayer({
          id: ID.poiLayer,
          type: "circle",
          source: ID.poiSrc,
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffffff",
            "circle-opacity": 0.95,
            "circle-stroke-width": 1,
            "circle-stroke-color": selectedRoute.color,
          },
        });
      }

      // 🔹 3) Compute bounds for selected route & smooth fit
      const bounds = new maplibregl.LngLatBounds();
      mergedLines.features.forEach((f) => {
        if (!f.geometry) return;
        if (f.geometry.type === "LineString") {
          (f.geometry.coordinates as [number, number][]).forEach((c) =>
            bounds.extend(c)
          );
        } else if (f.geometry.type === "MultiLineString") {
          (f.geometry.coordinates as [number, number][][]).forEach((line) =>
            line.forEach((c) => bounds.extend(c))
          );
        }
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 14.5,
          duration: 750,
        });
      }

      // 🔹 4) Flatten coords for playback
      const coords: [number, number][] = [];
      mergedLines.features.forEach((f) => {
        if (!f.geometry) return;
        if (f.geometry.type === "LineString") {
          (f.geometry.coordinates as [number, number][]).forEach((c) =>
            coords.push(c)
          );
        } else if (f.geometry.type === "MultiLineString") {
          (f.geometry.coordinates as [number, number][][]).forEach((line) =>
            line.forEach((c) => coords.push(c))
          );
        }
      });
      playbackCoordsRef.current = coords;

      // 🔹 5) Seed empty playback source (dot controlled by playback effect)
      map.addSource(ID.playbackSrc, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: ID.playbackLayer,
        type: "circle",
        source: ID.playbackSrc,
        paint: {
          "circle-radius": 5,
          "circle-color": selectedRoute.color,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    });
  }, [event?.eventId, selectedRoute?.id]);

  // 4. LIVE GPS DOT
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cleanupLayerAndSource = () => {
      const m = mapRef.current;
      if (!m) return;
      if (m.getLayer(ID.gpsLayer)) m.removeLayer(ID.gpsLayer);
      if (m.getSource(ID.gpsSrc)) m.removeSource(ID.gpsSrc);
    };

    const recenterOnSelectedRoute = () => {
      const m = mapRef.current;
      if (!m || !selectedRoute || !selectedRoute.geojson) return;

      try {
        const feature = selectedRoute.geojson.features[0];
        if (
          !feature ||
          !feature.geometry ||
          feature.geometry.type !== "LineString" ||
          !Array.isArray(feature.geometry.coordinates)
        ) {
          return;
        }

        const coords = feature.geometry
          .coordinates as [number, number][];

        if (!coords.length) return;

        const bounds = coords.reduce(
          (b, [lng, lat]) => b.extend([lng, lat]),
          new maplibregl.LngLatBounds(coords[0], coords[0])
        );

        m.fitBounds(bounds, {
          padding: 80,
          duration: 800,
        });
      } catch (err) {
        console.warn("[SUC] Failed to recenter on route:", err);
      }
    };

    // If turning OFF: clear watch + remove layer/source + recenter on route
    if (!isLiveGpsOn) {
      if (gpsWatchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }

      return withStyleLoaded(map, () => {
        cleanupLayerAndSource();
        recenterOnSelectedRoute();
      });
    }

    // If turning ON: start watching position
    if (!("geolocation" in navigator)) {
      console.warn("[SUC] Geolocation not supported in this browser.");
      return;
    }

    withStyleLoaded(map, () => {
      // reset any old GPS layer/source
      cleanupLayerAndSource();

      if (!map.getSource(ID.gpsSrc)) {
        map.addSource(ID.gpsSrc, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      if (!map.getLayer(ID.gpsLayer)) {
        map.addLayer({
          id: ID.gpsLayer,
          type: "circle",
          source: ID.gpsSrc,
          paint: {
            "circle-radius": 5,
            "circle-color": "#00d4ff",
            "circle-opacity": 1,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }
    });

    // start watching position and update dot + recenter on user
    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        const m = mapRef.current;
        if (!m) return;

        const src = m.getSource(ID.gpsSrc) as
          | maplibregl.GeoJSONSource
          | undefined;
        if (!src) return;

        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [longitude, latitude],
              },
              properties: {},
            },
          ],
        });

        m.easeTo({
          center: [longitude, latitude],
          duration: 800,
        });
      },
      (err) => {
        console.warn("[SUC] Geolocation error:", err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );

    // safety cleanup if effect re-runs / unmounts
    return () => {
      if (gpsWatchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };
  }, [isLiveGpsOn, selectedRoute]);

  // 5. PLAYBACK DOT ALONG SELECTED ROUTE
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const coords = playbackCoordsRef.current;
    if (!coords || coords.length < 2) return;

    const src = map.getSource(
      ID.playbackSrc
    ) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // If paused: dot at route start
    if (!isPlaybackOn) {
      const [lng, lat] = coords[0];
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {},
          },
        ],
      });
      return;
    }

    const total = coords.length;
    const scaled = playbackProgress * (total - 1);
    const idx = Math.floor(scaled);
    const maxIndex = total - 1;
    const t = scaled - idx;

    const start = coords[idx];
    const end = coords[Math.min(idx + 1, maxIndex)];
    if (!start || !end) return;

    const lng = start[0] + (end[0] - start[0]) * t;
    const lat = start[1] + (end[1] - start[1]) * t;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {},
        },
      ],
    });

    // Gentle follow-cam
    map.easeTo({
      center: [lng, lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      duration: 350,
    });
  }, [selectedRoute, playbackProgress, isPlaybackOn]);

  // 6. SAFETY: force MapLibre to re-check container size after event/route changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
  }, [event?.eventId, selectedRoute?.id]);

  return <div ref={containerRef} className="suc-map-inner" />;
}
