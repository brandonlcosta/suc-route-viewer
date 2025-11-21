// src/App.tsx — SUC Route Viewer (Unified Map Interaction)

import { useEffect, useMemo, useState } from "react";
import MultiRouteMap from "./components/MultiRouteMap";
import ElevationChart from "./components/ElevationChart";
import { loadSUCEvents } from "./data/loadEvents";
import type { SUCEvent, SUCRoute } from "./data/loadEvents";
import "./styles.css";

export default function App() {
  const [events, setEvents] = useState<SUCEvent[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Live GPS toggle
  const [isLiveGpsOn, setIsLiveGpsOn] = useState(false);

  // Playback state
  const [isPlaybackOn, setIsPlaybackOn] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<"slow" | "med" | "fast">(
    "med"
  );
  const [playbackProgress, setPlaybackProgress] = useState(0); // 0–1

  // Load event data on mount
  useEffect(() => {
    async function init() {
      const loaded = await loadSUCEvents();
      setEvents(loaded);

      if (loaded.length > 0) {
        const firstEvent = loaded[0];
        setActiveEventId(firstEvent.eventId);
        setSelectedRouteId(firstEvent.routes[0]?.id ?? null);
      }
    }

    init();
  }, []);

  const isLoading = events.length === 0;

  // Active event object
  const activeEvent: SUCEvent | null = useMemo(() => {
    if (events.length === 0) return null;
    return events.find((e) => e.eventId === activeEventId) ?? events[0];
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

  // Reset playback state (helper)
  const resetPlayback = () => {
    setIsPlaybackOn(false);
    setPlaybackProgress(0);
  };

  // Event switch
  const handleEventSelect = (eventId: string) => {
    setActiveEventId(eventId);

    const ev = events.find((e) => e.eventId === eventId);
    const firstRoute = ev?.routes[0];
    setSelectedRouteId(firstRoute ? firstRoute.id : null);

    resetPlayback();
  };

  // Route switch
  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
    resetPlayback();
  };

  // Playback loop — advances playbackProgress while isPlaybackOn is true.
  // Stops at the end, resets progress to 0, and flips isPlaybackOn to false.
  useEffect(() => {
    if (!isPlaybackOn || !selectedRoute) return;

    let frameId: number | null = null;
    let lastTime = performance.now();

    const baseDurationSeconds = 60; // MED: ~60s for full route
    const speedMult =
      playbackSpeed === "slow" ? 0.5 : playbackSpeed === "fast" ? 2 : 1;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setPlaybackProgress((prev) => {
        const next = prev + (dt * speedMult) / baseDurationSeconds;

        // Stop + reset when we reach the end
        if (next >= 1) {
          if (frameId !== null) {
            cancelAnimationFrame(frameId);
          }
          // turn playback off so button shows "Play" again
          setIsPlaybackOn(false);
          return 0; // reset progress for next run
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

  const togglePlayback = () => {
    if (!selectedRoute) return;

    // If we're starting playback, always reset to the start of the route
    if (!isPlaybackOn) {
      setPlaybackProgress(0);
      setIsPlaybackOn(true);
    } else {
      // Pause
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
                <span className="suc-event-datetime">
                  {activeEvent.eventDate && (
                    <span className="suc-event-date">
                      {activeEvent.eventDate}
                    </span>
                  )}

                  {activeEvent.eventDate && activeEvent.eventTime && (
                    <span className="suc-event-dot">•</span>
                  )}

                  {activeEvent.eventTime && (
                    <span className="suc-event-time">
                      {activeEvent.eventTime}
                    </span>
                  )}

                  {activeEvent.startLocationName && (
                    <>
                      {(activeEvent.eventDate || activeEvent.eventTime) && (
                        <span className="suc-event-dot">•</span>
                      )}

                      {activeEvent.startLocationUrl ? (
                        <a
                          href={activeEvent.startLocationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="suc-event-location"
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

                  <div className="suc-playback-speed-group">
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
                      {Math.round(
                        selectedRoute.elevationFt
                      ).toLocaleString()}{" "}
                      ft ↑
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
