// src/components/EventSwitcher.tsx
//
// Sidebar-style event + route switcher for SUC HQ
// - No Tailwind, just semantic classNames
// - Works with SUCEvent / SUCRoute
// - Designed to sit alongside the main map layout (desktop use)

import type { SUCEvent, SUCRoute } from "../data/loadEvents";

interface Props {
  events: SUCEvent[];
  activeEvent: SUCEvent | null;
  selectedRoute: SUCRoute | null;
  onEventSelect: (eventId: string) => void;
  onRouteSelect: (routeId: string) => void;
}

export default function EventSwitcher({
  events,
  activeEvent,
  selectedRoute,
  onEventSelect,
  onRouteSelect,
}: Props) {
  return (
    <aside className="suc-sidebar">
      {/* Events */}
      <section className="suc-sidebar-section">
        <h2 className="suc-sidebar-heading">Events</h2>
        <div className="suc-sidebar-list">
          {events.map((ev) => {
            const isActive = activeEvent?.eventId === ev.eventId;
            return (
              <button
                key={ev.eventId}
                type="button"
                onClick={() => onEventSelect(ev.eventId)}
                className={`suc-sidebar-event ${
                  isActive ? "is-active" : ""
                }`}
              >
                <div className="suc-sidebar-event-title">{ev.eventName}</div>

                {ev.eventDescription && (
                  <div className="suc-sidebar-event-description">
                    {ev.eventDescription}
                  </div>
                )}

                {(ev.eventDate || ev.eventTime) && (
                  <div className="suc-sidebar-event-meta">
                    {ev.eventDate && (
                      <span className="suc-sidebar-event-date">
                        {ev.eventDate}
                      </span>
                    )}
                    {ev.eventDate && ev.eventTime && (
                      <span className="suc-sidebar-dot">•</span>
                    )}
                    {ev.eventTime && (
                      <span className="suc-sidebar-event-time">
                        {ev.eventTime}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Routes for active event */}
      {activeEvent && (
        <section className="suc-sidebar-section">
          <h2 className="suc-sidebar-heading">Routes</h2>
          <div className="suc-sidebar-list">
            {activeEvent.routes.map((route) => {
              const isSelected = selectedRoute?.id === route.id;
              return (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => onRouteSelect(route.id)}
                  className={`suc-sidebar-route ${
                    isSelected ? "is-active" : ""
                  }`}
                >
                  <div className="suc-sidebar-route-header">
                    <span
                      className="suc-sidebar-route-name"
                      style={{ color: route.color }}
                    >
                      {route.name}
                    </span>
                    <span className="suc-sidebar-route-label">
                      {route.label}
                    </span>
                  </div>

                  {route.description && (
                    <div className="suc-sidebar-route-description">
                      {route.description}
                    </div>
                  )}

                  <div className="suc-sidebar-route-meta">
                    {route.distanceMi.toFixed(1)} mi ·{" "}
                    {Math.round(route.elevationFt).toLocaleString()} ft ↑
                  </div>

                  <a
                    href={route.gpxUrl}
                    download
                    className="suc-sidebar-route-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Download GPX
                  </a>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}
