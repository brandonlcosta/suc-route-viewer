/**
 * src/data/loadEvents.ts
 *
 * Purpose:
 *  - Load multi-event data produced by the A3 GPX converter.
 *  - Load events.json → route-level stats JSON → route GeoJSON linework.
 *  - Normalize into strict TypeScript structures.
 *
 * Inputs (static):
 *  - /public/events.json
 *  - /public/routes/<routeId>.json
 *  - /public/routes/<routeId>.geojson
 *
 * Outputs (frontend):
 *  - SUCEventCatalog
 *  - SUCEvent
 *  - SUCRoute
 *
 * Notes:
 *  - All fetches are done client-side.
 *  - Missing JSON/GeoJSON files are handled gracefully.
 *  - Ensures deterministic ordering of events and routes.
 */

/** Route as consumed by the frontend UI */
export interface SUCRoute {
  id: string;
  label: "MED" | "LRG" | "XL" | "XXL" | string;
  name: string;
  description: string;
  color: string;

  gpxUrl: string;
  geojsonUrl: string;
  statsUrl: string;

  distanceMi: number;
  distanceKm: number;
  elevationFt: number;
  elevationM: number;

  distanceSeries: number[];
  elevationSeries: number[];

  geojson: GeoJSON.FeatureCollection | null;
}

/** Event as consumed by the frontend UI */
export interface SUCEvent {
  eventId: string;
  eventName: string;
  eventDescription: string;
  /** Optional event date string straight from events.json / event.json */
  eventDate?: string;
  /** Optional event time string straight from events.json / event.json */
  eventTime?: string;
  routes: SUCRoute[];
}

export type SUCEventCatalog = SUCEvent[];

/**
 * Shape of each route reference inside /events.json
 * (points to the route-level stats + geojson files)
 */
interface EventsIndexRouteRef {
  label: string;
  statsUrl: string;
  geojsonUrl: string;
}

/**
 * Shape of each event row inside /events.json
 */
interface EventsIndexEvent {
  eventId: string;
  eventName: string;
  eventDescription: string;
  eventDate?: string;
  eventTime?: string;
  routes: EventsIndexRouteRef[];
}

/**
 * Shape of the route-level stats JSON
 * (/public/routes/<routeId>.json)
 */
interface RouteStats {
  id: string;
  label: string;
  name: string;
  description: string;
  color: string;

  gpxUrl: string;
  geojsonUrl: string;
  statsUrl: string;

  distanceMi: number;
  distanceKm: number;
  elevationFt: number;
  elevationM: number;

  distanceSeries: number[];
  elevationSeries: number[];
}

/**
 * Load JSON helper
 */
async function loadJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Load GeoJSON helper
 */
async function loadGeoJSON(
  url: string
): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

/**
 * Load all route-level data:
 *  - stats JSON
 *  - geojson linework
 */
async function loadRoute(
  routeMeta: EventsIndexRouteRef
): Promise<SUCRoute | null> {
  const stats = await loadJSON<RouteStats>(routeMeta.statsUrl);
  if (!stats) return null;

  const geojson = await loadGeoJSON(routeMeta.geojsonUrl);

  return {
    id: stats.id,
    label: stats.label,
    name: stats.name,
    description: stats.description,
    color: stats.color,

    gpxUrl: stats.gpxUrl,
    geojsonUrl: stats.geojsonUrl,
    statsUrl: stats.statsUrl,

    distanceMi: stats.distanceMi,
    distanceKm: stats.distanceKm,
    elevationFt: stats.elevationFt,
    elevationM: stats.elevationM,

    distanceSeries: stats.distanceSeries,
    elevationSeries: stats.elevationSeries,

    geojson,
  };
}

/**
 * Load all events + their routes
 */
export async function loadSUCEvents(): Promise<SUCEventCatalog> {
  const events = await loadJSON<EventsIndexEvent[]>("/events.json");
  if (!events || !Array.isArray(events)) return [];

  const catalog: SUCEventCatalog = [];

  for (const ev of events) {
    const loadedRoutes: SUCRoute[] = [];

    // Load each referenced route
    for (const routeRef of ev.routes) {
      const loaded = await loadRoute(routeRef);
      if (loaded) loadedRoutes.push(loaded);
    }

    // Deterministic route ordering:
    //  - shortest distance on the left
    //  - fall back to label ordering if distances are equal/missing
    loadedRoutes.sort((a, b) => {
      const da = Number.isFinite(a.distanceMi) ? a.distanceMi : Infinity;
      const db = Number.isFinite(b.distanceMi) ? b.distanceMi : Infinity;

      if (da !== db) return da - db;
      return a.label.localeCompare(b.label);
    });

    catalog.push({
      eventId: ev.eventId,
      eventName: ev.eventName,
      eventDescription: ev.eventDescription,
      eventDate: ev.eventDate,
      eventTime: ev.eventTime,
      routes: loadedRoutes,
    });
  }

  // Deterministic event ordering
  catalog.sort((a, b) => a.eventId.localeCompare(b.eventId));

  return catalog;
}
