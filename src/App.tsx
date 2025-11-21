// src/App.tsx — SUC Route Viewer (Unified Map Interaction)

import { useEffect, useMemo, useState } from "react";
import MultiRouteMap from "./components/MultiRouteMap";
import ElevationChart from "./components/ElevationChart";
import { loadSUCEvents } from "./data/loadEvents";
import type { SUCEvent, SUCRoute } from "./data/loadEvents";
import type { FeatureCollection, LineString } from "geojson";
import "./styles.css";

function thinCoordinates(
  coords: [number, number][],
  step: number
): [number, number][] {
  if (coords.length <= step) return coords;
  const result: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) {
    result.push(coords[i]);
  }
  const last = coords[coords.length - 1];
  if (result[result.length - 1] !== last) {
    result.push(last);
  }
  return result;
}


// Choose the default route for an event: prefer "XL", else longest distance
function pickDefaultRoute(event: SUCEvent | null): SUCRoute | null {
  if (!event || !event.routes.length) return null;

  const xl = event.routes.find((r) => r.label === "XL");
  if (xl) return xl;

  return event.routes.reduce((best, r) =>
    !best || r.distanceMi > best.distanceMi ? r : best
  );
}

export default function App() {
  const [events, setEvents] = useState<SUCEvent[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

// Live GPS toggle
const [isLiveGpsOn, setIsLiveGpsOn] = useState(false);
console.log("App isLiveGpsOn:", isLiveGpsOn);

  // Playback state
  const [isPlaybackOn, setIsPlaybackOn] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<"slow" | "med" | "fast">(
    "med"
  );
  const [playbackProgress, setPlaybackProgress] = useState(0); // 0–1

  // Permanent ghost layer — all SUC routes as a low-opacity underlay
  const permanentRoutesGeoJson = useMemo<FeatureCollection<LineString> | null>(
    () => {
      if (!events.length) return null;

      const features: FeatureCollection<LineString>["features"] = [];

      for (const event of events) {
        for (const route of event.routes) {
          const fc = route.geojson;
          if (!fc || !Array.isArray(fc.features)) continue;

          for (const rawFeature of fc.features as any[]) {
            const geom = rawFeature.geometry;
            if (!geom) continue;

            const baseProps = {
              eventId: event.eventId,
              eventName: event.eventName,
              routeId: route.id,
              routeName: route.name,
            };

            if (geom.type === "LineString") {
              const coords = geom.coordinates as [number, number][];
              if (!coords || coords.length < 2) continue;

              const thinned = thinCoordinates(coords, 8);

              features.push({
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: thinned,
                },
                properties: baseProps,
              });
            } else if (geom.type === "MultiLineString") {
              const lines = geom.coordinates as [number, number][][];

              for (const line of lines) {
                if (!line || line.length < 2) continue;
                const thinned = thinCoordinates(line, 8);

                features.push({
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: thinned,
                  },
                  properties: baseProps,
                });
              }
            }
          }
        }
      }

      if (!features.length) return null;

      return {
        type: "FeatureCollection",
        features,
      };
    },
    [events]
  );

  // Load event data on mount
  useEffect(() => {
    async function init() {
      const loaded = await loadSUCEvents();
      setEvents(loaded);

      // Choose newest event (already sorted in loadSUCEvents)
      if (loaded.length > 0) {
        const newestEvent = loaded[0];
        setActiveEventId(newestEvent.eventId);

        // Pick default route: XL → longest
        const defaultRoute = pickDefaultRoute(newestEvent);
        setSelectedRouteId(defaultRoute ? defaultRoute.id : null);
      }
    }

    init();
  }, []);


  const isLoading = events.length === 0;

  // Active event object
  const activeEvent: SUCEvent | null = useMemo(() => {
    if (!events.length) return null;
    const ev = events.find((e) => e.eventId === activeEventId) ?? events[0];
    return ev ? { ...ev } : null; // force new object reference for map effects if needed
  }, [events, activeEventId]);

  // Selected route object
  const selectedRoute: SUCRoute | null = useMemo(() => {
    if (!activeEvent) return null;
    return (
      activeEvent.routes.find((r) => r.id === selectedRouteId) ??
      activeEvent.routes[0] ??
      null
    );
  }, [activeEvent, selectedRouteId]);

  // Playback loop — advances playbackProgress while isPlaybackOn is true.
  useEffect(() => {
    if (!isPlaybackOn || !selectedRoute) return;

    let frameId: number | null = null;
    let lastTime = performance.now();

    const baseDurationSeconds = 60; // MED: ~60s for full route
    const speedMult =
      playbackSpeed === "slow" ? 2 : playbackSpeed === "fast" ? 0.25 : 1;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setPlaybackProgress((prev) => {
        const routeDistance = selectedRoute.distanceMi || 1;
        const duration =
          baseDurationSeconds * (routeDistance / 10) * speedMult;

        const delta = dt / duration;
        const next = prev + delta;

        if (next >= 1) {
          setIsPlaybackOn(false);
          return 0;
        }

        return next;
      });

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [isPlaybackOn, playbackSpeed, selectedRoute]);

  const resetPlayback = () => {
    setIsPlaybackOn(false);
    setPlaybackProgress(0);
  };

  const handleEventSelect = (eventId: string) => {
    const ev = events.find((e) => e.eventId === eventId) ?? null;
    const defaultRoute = pickDefaultRoute(ev);
    const newRouteId = defaultRoute ? defaultRoute.id : null;

    setActiveEventId(eventId);
    setSelectedRouteId(newRouteId);
    resetPlayback();
  };

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
    resetPlayback();
  };

  const togglePlayback = () => {
    if (!selectedRoute) return;

    if (!isPlaybackOn) {
      setPlaybackProgress(0);
      setIsPlaybackOn(true);
    } else {
      setIsPlaybackOn(false);
    }
  };

  const setSpeed = (speed: "slow" | "med" | "fast") => {
    setPlaybackSpeed(speed);
  };

  return (
    <div className="suc-app">
      {/* HEADER */}
      <header className="suc-header suc-header--compact">
        <div className="suc-header-left">
          <div className="suc-header-row">
            {isLoading && <span>Loading events…</span>}

            {!isLoading && activeEvent && (
              <select
                className="suc-event-select suc-event-select--compact"
                value={activeEvent.eventId}
                onChange={(e) => handleEventSelect(e.target.value)}
              >
                {events.map((ev) => (
                  <option key={ev.eventId} value={ev.eventId}>
                    {ev.eventName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {activeEvent && (
            <div className="suc-header-meta">
              {activeEvent.eventDescription && (
                <span className="suc-event-description">
                  {activeEvent.eventDescription}
                </span>
              )}

              {(activeEvent.eventDate ||
                activeEvent.eventTime ||
                activeEvent.startLocationName) && (
                <span className="suc-event-meta-row">
                  {activeEvent.eventDate && (
                    <span className="suc-event-meta-pill">
                      {activeEvent.eventDate}
                    </span>
                  )}

                  {activeEvent.eventTime && (
                    <span className="suc-event-meta-pill">
                      {activeEvent.eventTime}
                    </span>
                  )}

                  {activeEvent.startLocationName && (
                    <>
                      <span className="suc-event-meta-divider">•</span>
                      {activeEvent.startLocationUrl ? (
                        <a
                          href={activeEvent.startLocationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="suc-event-location suc-event-location--link"
                        >
                          Start: {activeEvent.startLocationName}
                        </a>
                      ) : (
                        <span className="suc-event-location">
                          Start: {activeEvent.startLocationName}
                        </span>
                      )}
                    </>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="suc-header-right">
          <button
            className="suc-settings-btn"
            onClick={() => alert("Settings panel coming soon!")}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* MAIN */}
      <main className="suc-main-vertical">
        {/* MAP PANEL */}
        <section className="suc-map-shell">
          <div className="suc-map-panel">
            <div className="suc-map-container">
              <MultiRouteMap
                event={activeEvent}
                selectedRoute={selectedRoute}
                isLiveGpsOn={isLiveGpsOn}
                playbackProgress={playbackProgress}
                isPlaybackOn={isPlaybackOn}
                permanentRoutesGeoJson={permanentRoutesGeoJson}
              />

              {/* LIVE GPS TOGGLE */}
              <button
                type="button"
                className={`suc-gps-toggle ${
                  isLiveGpsOn ? "suc-gps-toggle--on" : ""
                }`}
                onClick={() => setIsLiveGpsOn((prev) => !prev)}
                aria-pressed={isLiveGpsOn}
                aria-label={isLiveGpsOn ? "Disable live GPS" : "Enable live GPS"}
              >
                <span className="suc-gps-toggle-dot" />
                <span className="suc-gps-toggle-label">
                  {isLiveGpsOn ? "LIVE" : "GPS"}
                </span>
              </button>

              {/* ROUTE PLAYBACK CONTROLS */}
              {selectedRoute && (
                <div className="suc-playback-controls">
                  <button
                    type="button"
                    className="suc-playback-btn suc-playback-btn-main"
                    onClick={togglePlayback}
                  >
                    {isPlaybackOn ? "Pause" : "Play"}
                  </button>

                  <div className="suc-playback-speeds">
                    <button
                      type="button"
                      className={`suc-playback-btn ${
                        playbackSpeed === "slow" ? "is-active" : ""
                      }`}
                      onClick={() => setSpeed("slow")}
                    >
                      Slow
                    </button>
                    <button
                      type="button"
                      className={`suc-playback-btn ${
                        playbackSpeed === "med" ? "is-active" : ""
                      }`}
                      onClick={() => setSpeed("med")}
                    >
                      Med
                    </button>
                    <button
                      type="button"
                      className={`suc-playback-btn ${
                        playbackSpeed === "fast" ? "is-active" : ""
                      }`}
                      onClick={() => setSpeed("fast")}
                    >
                      Fast
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ROUTES + DETAILS */}
        {activeEvent && (
          <section className="suc-routelist-shell">
            {/* Route Tabs */}
            <div className="suc-route-tabs">
              {activeEvent.routes.map((route) => (
                <button
                  key={route.id}
                  type="button"
                  className={`suc-route-tab-btn ${route.label} ${
                    route.id === selectedRouteId ? "is-selected" : ""
                  }`}
                  onClick={() => handleRouteSelect(route.id)}
                >
                  <span className="suc-route-tab-label">{route.label}</span>
                  <span className="suc-route-tab-distance">
                    {route.distanceMi.toFixed(1)} mi
                  </span>
                </button>
              ))}
            </div>

            {/* Detail Card */}
            {selectedRoute && (
              <div className="suc-route-detail">
                <div className="suc-route-detail-header">
                  <span
                    className={`suc-route-tag suc-route-tag-${selectedRoute.label}`}
                  >
                    {selectedRoute.label}
                  </span>

                  <div className="suc-route-detail-titleblock">
                    <span className="suc-route-detail-stats">
                      {selectedRoute.distanceMi.toFixed(1)} mi ·{" "}
                      {Math.round(selectedRoute.elevationFt).toLocaleString()} ft
                      {" "}↑
                    </span>
                  </div>
                </div>

                {selectedRoute.description && (
                  <p className="suc-route-detail-description">
                    {selectedRoute.description}
                  </p>
                )}

                <ElevationChart
                  route={selectedRoute}
                  playbackProgress={playbackProgress}
                />

                <div className="suc-route-detail-actions">
                  <a href={selectedRoute.gpxUrl} download>
                    Download GPX
                  </a>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="suc-footer">
        <span>Serving SUC routes at routes.sacultracrew.com</span>
      </footer>
    </div>
  );
}
