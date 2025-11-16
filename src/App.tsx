// src/App.tsx — SUC Route Viewer (Compact Header + Route Tabs Layout)

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

  // Initial load
  useEffect(() => {
    async function init() {
      const ev = await loadSUCEvents();
      setEvents(ev);

      if (ev.length > 0) {
        const firstEvent = ev[0];
        const firstRoute = firstEvent.routes[0];

        setActiveEventId(firstEvent.eventId);
        setSelectedRouteId(firstRoute ? firstRoute.id : null);
      }
    }
    init();
  }, []);

  // Derive active event from ID + events
  const activeEvent: SUCEvent | null = useMemo(() => {
    if (events.length === 0) return null;
    if (!activeEventId) return events[0];
    return events.find((e) => e.eventId === activeEventId) ?? events[0];
  }, [events, activeEventId]);

  // Derive selected route from ID + active event
  const selectedRoute: SUCRoute | null = useMemo(() => {
    if (!activeEvent || activeEvent.routes.length === 0) return null;
    if (!selectedRouteId) return activeEvent.routes[0];
    return (
      activeEvent.routes.find((r) => r.id === selectedRouteId) ??
      activeEvent.routes[0]
    );
  }, [activeEvent, selectedRouteId]);

  const handleEventSelect = (eventId: string) => {
    setActiveEventId(eventId);

    const ev = events.find((e) => e.eventId === eventId);
    const firstRoute = ev?.routes[0];
    setSelectedRouteId(firstRoute ? firstRoute.id : null);
  };

  const handleRouteSelect = (route: SUCRoute) => {
    setSelectedRouteId(route.id);
  };

  const selectedRouteTag = selectedRoute ? getRouteTag(selectedRoute) : null;

  return (
    <div className="suc-app">
      {/* Compact Header with Event Selector */}
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
                  <span className="suc-event-time">{activeEvent.eventTime}</span>
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

      {/* MAIN LAYOUT — Map on top, Routes below */}
      <main className="suc-main-vertical">
        {/* MAP BLOCK */}
        <section className="suc-map-shell">
          <div className="suc-map-panel">
            <div className="suc-map-header">
              <h2>Map</h2>
              {selectedRoute && (
                <span className="suc-map-route-meta">
                  {selectedRouteTag && (
                    <span className="suc-route-tag suc-route-tag-inline">
                      {selectedRouteTag}
                    </span>
                  )}
                  <span className="suc-map-route-name">
                    {selectedRoute.name}
                  </span>
                  <span className="suc-map-route-stats">
                    {selectedRoute.distanceMi.toFixed(1)} mi ·{" "}
                    {Math.round(selectedRoute.elevationFt).toLocaleString()} ft ↑
                  </span>
                </span>
              )}
            </div>

            <div className="suc-map-container">
              <MultiRouteMap event={activeEvent} selectedRoute={selectedRoute} />
            </div>
          </div>
        </section>

        {/* ROUTE TABS + DETAIL BELOW MAP */}
        {activeEvent && (
          <section className="suc-routelist-shell">
            <div className="suc-route-tabs">
              {activeEvent.routes.map((route) => {
                const isSelected = route.id === selectedRouteId;
                const tag = getRouteTag(route);

                return (
                  <button
                    key={route.id}
                    type="button"
                    className={`suc-route-tab-btn ${tag ?? ""} ${
                      isSelected ? "is-selected" : ""
                    }`}
                    onClick={() => handleRouteSelect(route)}
                  >
                    {tag && (
                      <span className="suc-route-tab-label">
                        {tag}
                      </span>
                    )}
                    <span className="suc-route-tab-distance">
                      {route.distanceMi.toFixed(1)} mi
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedRoute && (
              <div className="suc-route-detail">
                <div className="suc-route-detail-header">
                  {selectedRouteTag && (
                    <span
                      className={`suc-route-tag suc-route-tab-tag suc-route-tag-${selectedRouteTag}`}
                    >
                      {selectedRouteTag}
                    </span>
                  )}
                  <div className="suc-route-detail-titleblock">
                    <span className="suc-route-detail-name">
                      {selectedRoute.name}
                    </span>
                    <span className="suc-route-detail-stats">
                      {selectedRoute.distanceMi.toFixed(1)} mi ·{" "}
                      {Math.round(selectedRoute.elevationFt).toLocaleString()} ft
                      ↑
                    </span>
                  </div>
                </div>

                {selectedRoute.description && (
                  <p className="suc-route-detail-description">
                    {selectedRoute.description}
                  </p>
                )}

                {/* Inline elevation chart for the selected route */}
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

/**
 * Map verbose route names to short tags.
 * Falls back to null if we can't infer.
 */
function getRouteTag(route: SUCRoute): string | null {
  const name = route.name.toLowerCase();

  if (name.includes("xxl")) return "XXL";
  if (name.includes("xl")) return "XL";
  if (name.includes("medium") || name.startsWith("med")) return "MED";
  if (name.includes("large") || name.startsWith("lrg")) return "LRG";

  return null;
}
