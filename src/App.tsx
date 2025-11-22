// src/App.tsx — SUC Route Viewer (Unified Map Interaction + Calendar Strip)

import { useEffect, useMemo, useRef, useState } from "react";
import MultiRouteMap from "./components/MultiRouteMap";
import ElevationChart from "./components/ElevationChart";
import { loadSUCEvents } from "./data/loadEvents";
import type { SUCEvent, SUCRoute } from "./data/loadEvents";
import type { FeatureCollection, LineString } from "geojson";
import "./styles.css";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

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

const ROUTE_LABEL_ORDER = ["MED", "LRG", "XL", "XXL"];

function getRouteLabels(ev: SUCEvent): string[] {
  if (!ev.routes || ev.routes.length === 0) return [];
  const set = new Set<string>();
  for (const r of ev.routes) {
    if (r.label) set.add(r.label);
  }
  return Array.from(set).sort((a, b) => {
    const ai = ROUTE_LABEL_ORDER.indexOf(a);
    const bi = ROUTE_LABEL_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
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

function formatDayOfWeekShort(dateStr?: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short" }); // "Sat"
}

type RouteSummary = {
  key: string;
  label: string | null;      // MED / LRG / XL / XXL, or null if single-route
  distanceLabel: string;     // "10.2 mi"
};

function getRouteSummaries(ev: SUCEvent): RouteSummary[] {
  if (!ev.routes || ev.routes.length === 0) return [];
  return ev.routes.map((r) => ({
    key: r.id,
    label: r.label ?? null,
    distanceLabel: `${r.distanceMi.toFixed(1)} mi`,
  }));
}


// ─────────────────────────────────────────────────────────────
// Calendar strip types + helpers
// ─────────────────────────────────────────────────────────────

type CalendarDay = {
  key: string; // e.g. "2025-11-21"
  label: string; // e.g. "11-21"
  events: SUCEvent[];
};

function normalizeEventDateKey(ev: SUCEvent): string {
  if (ev.eventDate) {
    const d = new Date(ev.eventDate);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    // If it already looks like "YYYY-MM-DD", keep it
    if (ev.eventDate.length >= 10) {
      return ev.eventDate.slice(0, 10);
    }
    return ev.eventDate;
  }

  // Fallback: stable key based on ID if no date (should be rare)
  return ev.eventId;
}

function formatCalendarLabel(ev: SUCEvent): string {
  if (!ev.eventDate) return ev.eventId;

  const d = new Date(ev.eventDate);
  if (Number.isNaN(d.getTime())) return ev.eventDate;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  }); 
}


function formatPrettyEventDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

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

  // Calendar state
  const [activeCalendarDayKey, setActiveCalendarDayKey] = useState<
    string | null
  >(null);
  const [overlayCalendarEvents, setOverlayCalendarEvents] = useState<
    SUCEvent[] | null
  >(null);
  const calendarStripRef = useRef<HTMLDivElement | null>(null);

  const isLoading = events.length === 0;

  // Permanent ghost layer — all SUC routes as a low-opacity underlay
  const permanentRoutesGeoJson = useMemo<FeatureCollection<LineString> | null>(
    () => {
      if (!events.length) return null;

      const features: FeatureCollection<LineString>["features"] = [];

      for (const event of events) {
        for (const route of event.routes) {
          const fc = route.geojson as any;
          if (!fc || !Array.isArray(fc.features)) continue;

          for (const rawFeature of fc.features as any[]) {
            const geom = rawFeature.geometry;
            if (!geom) continue;

            const baseProps = {
              eventId: event.eventId,
              eventName: event.eventName,
              routeId: route.id,
              routeName: route.name,
              routeLabel: route.label,
            };

            if (geom.type === "LineString") {
              const coords = geom.coordinates as [number, number][];
              const thinned = thinCoordinates(coords, 5);
              features.push({
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: thinned,
                },
                properties: baseProps,
              } as any);
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

      if (loaded.length > 0) {
        // loadSUCEvents returns newest-first; pick first as default
        const newestEvent = loaded[0];
        setActiveEventId(newestEvent.eventId);

        const defaultRoute = pickDefaultRoute(newestEvent);
        setSelectedRouteId(defaultRoute ? defaultRoute.id : null);

        const dayKey = normalizeEventDateKey(newestEvent);
        setActiveCalendarDayKey(dayKey);
      }
    }

    void init();
  }, []);

  // Active event object
  const activeEvent: SUCEvent | null = useMemo(() => {
    if (!events.length) return null;
    const ev = events.find((e) => e.eventId === activeEventId) ?? events[0];
    return ev ? { ...ev } : null;
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

    // Always snap the selected route to this event's default (usually XL)
  // whenever the active event changes.
  useEffect(() => {
    if (!activeEvent) return;

    const defaultRoute = pickDefaultRoute(activeEvent);
    if (!defaultRoute) return;

    setSelectedRouteId((prev) => {
      if (prev === defaultRoute.id) return prev;
      return defaultRoute.id;
    });

    // also reset playback whenever we jump to a new event
    resetPlayback();
  }, [activeEvent]);

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

    if (ev) {
      const dayKey = normalizeEventDateKey(ev);
      setActiveCalendarDayKey(dayKey);
    }
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

  // ───────────────────────────────────────────────────────────
  // Calendar strip derived data + behavior
  // ───────────────────────────────────────────────────────────

  const calendarDays = useMemo<CalendarDay[]>(() => {
    if (!events.length) return [];

    const map = new Map<string, CalendarDay>();

    for (const ev of events) {
      // Only days that actually HAVE events are considered here
      const key = normalizeEventDateKey(ev);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          label: formatCalendarLabel(ev), // "11-21" style
          events: [ev],
        });
      } else {
        existing.events.push(ev);
      }
    }

    // Sort keys lexicographically — "YYYY-MM-DD" matches chronological
    const orderedKeys = Array.from(map.keys()).sort();
    return orderedKeys.map((k) => map.get(k)!).filter(Boolean);
  }, [events]);

  // Keep active calendar day in sync with active event
  useEffect(() => {
    if (!activeEvent) return;
    const dayKey = normalizeEventDateKey(activeEvent);
    setActiveCalendarDayKey(dayKey);
  }, [activeEvent]);

  // Auto-scroll calendar strip so active day is visible at the left-ish edge
  useEffect(() => {
    if (!calendarStripRef.current || !activeCalendarDayKey) return;

    const container = calendarStripRef.current;
    const activeEl = container.querySelector<HTMLButtonElement>(
      `[data-day-key="${activeCalendarDayKey}"]`
    );
    if (!activeEl) return;

    const targetLeft = activeEl.offsetLeft - container.clientWidth * 0.12;

    container.scrollTo({
      left: Math.max(targetLeft, 0),
      behavior: "smooth",
    });
  }, [activeCalendarDayKey, calendarDays.length]);

  const handleCalendarDayClick = (dayKey: string) => {
    setActiveCalendarDayKey(dayKey);
    const day = calendarDays.find((d) => d.key === dayKey);
    if (day) {
      setOverlayCalendarEvents(day.events);
      // Optional: also switch the main event to the first one on that day
      const first = day.events[0];
      if (first) {
        handleEventSelect(first.eventId);
      }
    }
  };

  const closeCalendarOverlay = () => {
    setOverlayCalendarEvents(null);
  };

  // ───────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────

  return (
    <div className="suc-app">
      {/* CALENDAR STRIP — only days with events are shown */}
{calendarDays.length > 0 && (
  <div className="suc-calendar-shell">
    <div
      className="suc-calendar-strip-scroll"
      aria-label="SUC upcoming and past events"
      ref={calendarStripRef}
    >
      {calendarDays.map((day) => {
        const firstEv = day.events[0];
        const dow = formatDayOfWeekShort(firstEv?.eventDate);
        const timeText = firstEv?.eventTime ?? null;

        return (
          <button
            key={day.key}
            type="button"
            data-day-key={day.key}
            className={`suc-calendar-day ${
              day.key === activeCalendarDayKey ? "is-active" : ""
            }`}
            onClick={() => handleCalendarDayClick(day.key)}
          >
            {/* Date in top-left, like 11-21 */}
            <span className="suc-calendar-day-date">{day.label}</span>

            {/* Day-of-week + start time */}
            {(dow || timeText) && (
              <span className="suc-calendar-day-meta">
                {dow && <span>{dow}</span>}
                {dow && timeText && <span>·</span>}
                {timeText && <span>{timeText}</span>}
              </span>
            )}

            {/* If just one event on this day, show full details */}
            {day.events.length === 1 && firstEv && (
              <>
                <span className="suc-calendar-day-title">
                  {firstEv.eventName}
                </span>
                <div className="suc-calendar-day-routes">
                  {(() => {
                    const summaries = getRouteSummaries(firstEv);
                    if (summaries.length === 1) {
                      // Single-route event — clean white pill
                      const single = summaries[0];
                      return (
                        <span className="suc-calendar-day-routechip suc-calendar-day-routechip--single">
                          {single.distanceLabel}
                        </span>
                      );
                    }

                    return summaries.map((s) => (
                      <span
                        key={s.key}
                        className={`suc-calendar-day-routechip suc-calendar-day-routechip--${s.label ?? "single"}`}
                      >
                        {s.label && <strong>{s.label}</strong>}{" "}
                        
                      </span>
                    ));
                  })()}
                </div>
              </>
            )}

            {/* If multiple events on this day, show 2 mini rows */}
            {day.events.length > 1 && (
              <div className="suc-calendar-day-events has-multiple">
                {day.events.slice(0, 2).map((ev) => {
                  const summaries = getRouteSummaries(ev);
                  const singleRoute = summaries.length === 1;
                  const condensed = summaries.slice(0, 3);

                  return (
                    <div
                      key={ev.eventId}
                      className="suc-calendar-day-multi-event"
                    >
                      <span className="suc-calendar-day-title">
                        {ev.eventName}
                      </span>
                      <div className="suc-calendar-day-routes-inline">
                        {singleRoute ? (
                          <span className="suc-calendar-day-routechip suc-calendar-day-routechip--single">
                            {summaries[0].distanceLabel}
                          </span>
                        ) : (
                          condensed.map((s) => (
                            <span
                              key={s.key}
                              className={`suc-calendar-day-routechip suc-calendar-day-routechip--tiny suc-calendar-day-routechip--${s.label ?? "single"}`}
                            >
                              {s.label && <strong>{s.label}</strong>}{" "}
                              <span>{s.distanceLabel}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </button>
        );
      })}
    </div>
  </div>
)}


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
                key={activeEvent?.eventId ?? "none"}  // ⬅️ add this line
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
                  isLiveGpsOn ? "is-on" : ""
                }`}
                onClick={() => setIsLiveGpsOn((prev) => !prev)}
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
                    {isPlaybackOn ? "Pause replay" : "Play route"}
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

      {/* CALENDAR OVERLAY */}
      {overlayCalendarEvents && (
        <div
          className="suc-calendar-overlay-backdrop"
          onClick={closeCalendarOverlay}
        >
          <div
            className="suc-calendar-overlay-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="suc-calendar-overlay-header">
              <div className="suc-calendar-overlay-title-block">
                <span className="suc-calendar-overlay-kicker">
                  SUC calendar •{" "}
                  {formatPrettyEventDate(
                    overlayCalendarEvents[0]?.eventDate
                  ) ?? "TBA"}
                </span>
                <h2 className="suc-calendar-overlay-title">
                  {overlayCalendarEvents.length === 1
                    ? overlayCalendarEvents[0]?.eventName
                    : `${overlayCalendarEvents.length} runs`}
                </h2>
              </div>
              <button
                type="button"
                className="suc-calendar-overlay-close"
                onClick={closeCalendarOverlay}
                aria-label="Close calendar details"
              >
                ✕
              </button>
            </div>

            <div className="suc-calendar-overlay-body">
              {overlayCalendarEvents.map((ev) => (
                <article
                  key={ev.eventId}
                  className="suc-calendar-overlay-event"
                >
                  <header className="suc-calendar-overlay-event-header">
                    <h3>{ev.eventName}</h3>
                    <div className="suc-calendar-overlay-event-meta">
                      {formatPrettyEventDate(ev.eventDate) && (
                        <span className="pill">
                          {formatPrettyEventDate(ev.eventDate)}
                        </span>
                      )}
                      {ev.eventTime && (
                        <span className="pill">{ev.eventTime}</span>
                      )}
                      {ev.startLocationName && (
                        <span className="pill">
                          Start: {ev.startLocationName}
                        </span>
                      )}
                    </div>
                  </header>

                  {ev.eventDescription && (
                    <p className="suc-calendar-overlay-event-description">
                      {ev.eventDescription}
                    </p>
                  )}

                  <div className="suc-calendar-overlay-routes">
                    {ev.routes.map((route) => (
                      <div
                        key={route.id}
                        className={`suc-calendar-overlay-route suc-calendar-overlay-route-${route.label}`}
                      >
                        <div className="route-main">
                          <span className="route-label">{route.label}</span>
                          <span className="route-distance">
                            {route.distanceMi.toFixed(1)} mi
                          </span>
                          <span className="route-elev">
                            {Math.round(
                              route.elevationFt
                            ).toLocaleString()}{" "}
                            ft
                          </span>
                        </div>
                        {route.description && (
                          <p className="route-description">
                            {route.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="suc-footer">
        <span>Serving SUC routes at routes.sacultracrew.com</span>
      </footer>
    </div>
  );
}
