// src/App.tsx — SUC Route Viewer (Clean + Correct Map Updating)

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

  // Load events on mount
  useEffect(() => {
    async function init() {
      const loaded = await loadSUCEvents();
      setEvents(loaded);

      if (loaded.length > 0) {
        const firstEvent = loaded[0];
        setActiveEventId(firstEvent.eventId);

        if (firstEvent.routes.length > 0) {
          setSelectedRouteId(firstEvent.routes[0].id);
        }
      }
    }
    init();
  }, []);

  // Retrieve active event
  const activeEvent: SUCEvent | null = useMemo(() => {
    if (events.length === 0) return null;
    return events.find((e) => e.eventId === activeEventId) ?? events[0];
  }, [events, activeEventId]);

  // Retrieve selected route
  const selectedRoute: SUCRoute | null = useMemo(() => {
    if (!activeEvent) return null;
    return (
      activeEvent.routes.find((r) => r.id === selectedRouteId) ??
      activeEvent.routes[0] ??
      null
    );
  }, [activeEvent, selectedRouteId]);

  // Event change
  const handleEventSelect = (eventId: string) => {
    setActiveEventId(eventId);

    const ev = events.find((e) => e.eventId === eventId);
    const firstRoute = ev?.routes[0];
    setSelectedRouteId(firstRoute ? firstRoute.id : null);
  };

  // Route tab change
  const handleRouteSelect = (route: SUCRoute) => {
    setSelectedRouteId(route.id);
  };

  const tag = selectedRoute ? getRouteTag(selectedRoute) : null;

  return (
    <div className="suc-app">
      {/* HEADER */}
      <header className="suc-header suc-header--compact">
        <div className="suc-header-left">
          <div className="suc-header-row">
            {events.length === 0 && <span>Loading Events…</span>}

            {events.length > 0 && activeEvent && (
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
              <span className="suc-event-description">
                {activeEvent.eventDescription}
              </span>
              <span className="suc-event-datetime">
                {activeEvent.eventDate && (
                  <span className="suc-event-date">{activeEvent.eventDate}</span>
                )}
                {activeEvent.eventDate && activeEvent.eventTime && (
                  <span className="suc-event-dot">•</span>
                )}
                {activeEvent.eventTime && (
                  <span className="suc-event-time">
                    {activeEvent.eventTime}
                  </span>
                )}
              </span>
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

      {/* MAIN LAYOUT */}
      <main className="suc-main-vertical">
        {/* MAP */}
        <section className="suc-map-shell">
          <div className="suc-map-panel">
            <div className="suc-map-container">
              {/* Key ensures map updates cleanly when routes change */}
              <MultiRouteMap
                key={selectedRoute?.id}
                event={activeEvent}
                selectedRoute={selectedRoute}
              />
            </div>
          </div>
        </section>

        {/* ROUTES + DETAIL */}
        {activeEvent && (
          <section className="suc-routelist-shell">
            {/* Route Tabs */}
            <div className="suc-route-tabs">
              {activeEvent.routes.map((route) => {
                const isSelected = route.id === selectedRouteId;
                const routeTag = getRouteTag(route);

                return (
                  <button
                    key={route.id}
                    type="button"
                    className={`suc-route-tab-btn ${routeTag ?? ""} ${
                      isSelected ? "is-selected" : ""
                    }`}
                    onClick={() => handleRouteSelect(route)}
                  >
                    {routeTag && (
                      <span className="suc-route-tab-label">{routeTag}</span>
                    )}
                    <span className="suc-route-tab-distance">
                      {route.distanceMi.toFixed(1)} mi
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detail Card */}
            {selectedRoute && (
              <div className="suc-route-detail">
                <div className="suc-route-detail-header">
                  {tag && (
                    <span className={`suc-route-tag suc-route-tag-${tag}`}>
                      {tag}
                    </span>
                  )}

                  <div className="suc-route-detail-titleblock">
                    <span className="suc-route-detail-name">
                      {selectedRoute.name}
                    </span>
                    <span className="suc-route-detail-stats">
                      {selectedRoute.distanceMi.toFixed(1)} mi ·{" "}
                      {Math.round(selectedRoute.elevationFt).toLocaleString()} ft ↑
                    </span>
                  </div>
                </div>

                {selectedRoute.description && (
                  <p className="suc-route-detail-description">
                    {selectedRoute.description}
                  </p>
                )}

                <ElevationChart route={selectedRoute} />

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

/** Route tag classification */
function getRouteTag(route: SUCRoute): string | null {
  const n = route.name.toLowerCase();

  if (n.includes("xxl")) return "XXL";
  if (n.includes("xl")) return "XL";
  if (n.includes("med") || n.includes("medium")) return "MED";
  if (n.includes("lrg") || n.includes("large")) return "LRG";

  return null;
}
