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

  // Flattened coordinates for the currently selected route
  const playbackCoordsRef = useRef<[number, number][]>([]);

  // NEW: track whether this is the first route draw for this map instance
  const firstRouteFitDoneRef = useRef(false);

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

  // Utility: compute bounds from a FeatureCollection of LineString / MultiLineString
  function extendBoundsFromLines(
    bounds: maplibregl.LngLatBounds,
    features: Feature<Geometry, GeoJsonProperties>[]
  ) {
    features.forEach((f) => {
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

    // If we lose data or the map, remove the ghost layer entirely
    if (!map || !permanentRoutesGeoJson) {
      if (map) {
        if (map.getLayer(ID.permanentLayer)) map.removeLayer(ID.permanentLayer);
        if (map.getSource(ID.permanentSrc)) map.removeSource(ID.permanentSrc);
      }
      return;
    }

    return withStyleLoaded(map, () => {
      // Start with all routes
      let dataToUse: FeatureCollection<LineString> = permanentRoutesGeoJson;

      // Filter out the currently active event so we don't double-draw it
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

      // If there are no "other" events, remove ghost layer and bail
      if (!dataToUse.features.length) {
        if (map.getLayer(ID.permanentLayer)) map.removeLayer(ID.permanentLayer);
        if (map.getSource(ID.permanentSrc)) map.removeSource(ID.permanentSrc);
        return;
      }

      // Use your helper to add/update the source
      setGeoJsonSource(map, ID.permanentSrc, dataToUse);

      // Add the layer once, re-use it on updates
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

        // Keep ghosts under the event underlay if that exists
        if (map.getLayer(ID.baseLayer)) {
          map.addLayer(layerDefinition, ID.baseLayer);
        } else {
          map.addLayer(layerDefinition);
        }
      }
    });
  }, [permanentRoutesGeoJson, event]);

  // 3. BASE ROUTE UNDERLAY FOR ACTIVE EVENT + FIT TO EVENT
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !event) return;

    return withStyleLoaded(map, () => {
      if (map.getLayer(ID.baseLayer)) map.removeLayer(ID.baseLayer);
      if (map.getSource(ID.baseSrc)) map.removeSource(ID.baseSrc);

      const features: Feature<Geometry, GeoJsonProperties>[] = [];

      event.routes.forEach((route) => {
        const fc = route.geojson;
        if (!fc || !Array.isArray(fc.features)) return;

        fc.features.forEach((f) =>
          features.push(f as Feature<Geometry, GeoJsonProperties>)
        );
      });

      if (features.length === 0) return;

      const merged: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features,
      };

      map.addSource(ID.baseSrc, { type: "geojson", data: merged });

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

      const bounds = new maplibregl.LngLatBounds();
      extendBoundsFromLines(bounds, merged.features);

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 70,
          maxZoom: 13,
          duration: 900,
        });
      }
    });
  }, [event]);

  // 4. SELECTED ROUTE HIGHLIGHT + FIT TO ROUTE + PREP PLAYBACK COORDS
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    return withStyleLoaded(map, () => {
      // If no selectedRoute, clear playback + (optionally) selected layer
      if (!selectedRoute || !selectedRoute.geojson) {
        playbackCoordsRef.current = [];
        const playbackSrc = map.getSource(
          ID.playbackSrc
        ) as maplibregl.GeoJSONSource | undefined;
        if (playbackSrc) {
          playbackSrc.setData({
            type: "FeatureCollection",
            features: [],
          });
        }
        return;
      }

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

      if (lineFeatures.length === 0) {
        // No line geometry, nothing to draw (don't blow away previous layers)
        return;
      }

      const mergedLines: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features: lineFeatures,
      };

      // Selected route geometry source (update or add)
      const existingSelectedSrc = map.getSource(
        ID.selectedSrc
      ) as maplibregl.GeoJSONSource | undefined;
      if (existingSelectedSrc) {
        existingSelectedSrc.setData(mergedLines as any);
      } else {
        map.addSource(ID.selectedSrc, {
          type: "geojson",
          data: mergedLines,
        });
      }

      // Neon glow layer (create once, just update paint if it exists)
      if (!map.getLayer(ID.selectedGlow)) {
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
      } else {
        map.setPaintProperty(ID.selectedGlow, "line-color", selectedRoute.color);
      }

      // Crisp center line
      if (!map.getLayer(ID.selectedLine)) {
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
      } else {
        map.setPaintProperty(ID.selectedLine, "line-color", selectedRoute.color);
      }

      // POIs — easiest to just rebuild this one
      if (map.getLayer(ID.poiLayer)) map.removeLayer(ID.poiLayer);
      if (map.getSource(ID.poiSrc)) map.removeSource(ID.poiSrc);

      if (poiFeatures.length > 0) {
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

      // Fit camera to the selected route ONLY the first time
      const bounds = new maplibregl.LngLatBounds();
      extendBoundsFromLines(bounds, mergedLines.features);

      if (!bounds.isEmpty() && !firstRouteFitDoneRef.current) {
        map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 14.5,
          duration: 800,
        });
        firstRouteFitDoneRef.current = true;
      }


      // Flatten coords for playback
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

      // Playback dot source (update or add, empty at first)
      const playbackSrc = map.getSource(
        ID.playbackSrc
      ) as maplibregl.GeoJSONSource | undefined;
      const emptyPlayback: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      if (playbackSrc) {
        playbackSrc.setData(emptyPlayback);
      } else {
        map.addSource(ID.playbackSrc, {
          type: "geojson",
          data: emptyPlayback,
        });
      }

      if (!map.getLayer(ID.playbackLayer)) {
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
      } else {
        map.setPaintProperty(
          ID.playbackLayer,
          "circle-color",
          selectedRoute.color
        );
      }
    });
  }, [selectedRoute]);

  // 5. LIVE GPS DOT
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
      // assume the main line is the first feature
      const feature = selectedRoute.geojson.features[0];
      if (
        !feature ||
        feature.geometry.type !== "LineString" ||
        !Array.isArray(feature.geometry.coordinates)
      ) {
        return;
      }

      const coords = feature.geometry
        .coordinates as [number, number][];

      if (!coords.length) return;

      const bounds = coords.reduce((b, [lng, lat]) => {
        return b.extend([lng, lat]);
      }, new maplibregl.LngLatBounds(coords[0], coords[0]));

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


  // 6. PLAYBACK DOT ALONG SELECTED ROUTE
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

  return <div ref={containerRef} className="suc-map-inner" />;
}
