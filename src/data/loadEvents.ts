/**
 * src/data/loadEvents.ts — SUC HQ Unified Loader (v2.1)
 *
 * Responsibilities:
 *  - Load multi-event catalog (/events.json)
 *  - Load per-route stats JSON + GeoJSON linework
 *  - Normalize into strict SUCEvent / SUCRoute structures
 *  - Provide safe, deterministic ordering every time
 *
 * Notes:
 *  - This is a frontend-only loader (no server).
 *  - Fails gracefully on missing files.
 *  - 100% compatible with the new Unified Route Map engine.
 */

//
// ─────────────────────────────────────────────────────────────
// Types exposed to application
// ─────────────────────────────────────────────────────────────
//

export interface SUCRoute {
  id: string;
  label: "MED" | "LRG" | "XL" | "XXL";
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

export interface SUCEvent {
  eventId: string;
  eventName: string;
  eventDescription: string;
  eventDate?: string;
  eventTime?: string;
  eventStartLocation?: string; // 👈 NEW

  routes: SUCRoute[];
}

export type SUCEventCatalog = SUCEvent[];

//
// ─────────────────────────────────────────────────────────────
// Types for raw files inside /public/events.json
// ─────────────────────────────────────────────────────────────
//

interface EventsIndexRouteRef {
  label: string;      // "XL", "MED", etc.
  statsUrl: string;   // /routes/<id>.json
  geojsonUrl: string; // /routes/<id>.geojson
}

interface EventsIndexEvent {
  eventId: string;
  eventName: string;
  eventDescription: string;
  eventDate?: string;
  eventTime?: string;
  eventStartLocation?: string; // 👈 NEW
  routes: EventsIndexRouteRef[];
}

//
// ─────────────────────────────────────────────────────────────
// Types for per-route stats JSON (/routes/<id>.json)
// ─────────────────────────────────────────────────────────────
//

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

//
// ─────────────────────────────────────────────────────────────
// Safe JSON loaders
// ─────────────────────────────────────────────────────────────
//

async function loadJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadGeoJSON(
  url: string
): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

//
// ─────────────────────────────────────────────────────────────
// Normalize route labels → strict MED/LRG/XL/XXL
// ─────────────────────────────────────────────────────────────
//

function normalizeLabel(raw: string): "MED" | "LRG" | "XL" | "XXL" {
  const s = raw.toLowerCase();

  if (s.includes("xxl")) return "XXL";
  if (s.includes("xl")) return "XL";
  if (s.includes("lrg") || s.includes("large")) return "LRG";
  if (s.includes("med") || s.includes("medium")) return "MED";

  // fallback: treat unknown as XL but log for debugging
  console.warn("[SUC] Unknown route label:", raw, "→ defaulting to XL");
  return "XL";
}

//
// ─────────────────────────────────────────────────────────────
// Load full route payload (stats + geojson)
// ─────────────────────────────────────────────────────────────
//

async function loadRoute(
  routeMeta: EventsIndexRouteRef
): Promise<SUCRoute | null> {
  const stats = await loadJSON<RouteStats>(routeMeta.statsUrl);
  if (!stats) return null;

  const geojson = await loadGeoJSON(routeMeta.geojsonUrl);

  return {
    id: stats.id,

    // normalized and safe
    label: normalizeLabel(stats.label),
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

    distanceSeries: stats.distanceSeries ?? [],
    elevationSeries: stats.elevationSeries ?? [],

    geojson,
  };
}

//
// ─────────────────────────────────────────────────────────────
// Load the entire SUC event catalog
// ─────────────────────────────────────────────────────────────
//

export async function loadSUCEvents(): Promise<SUCEventCatalog> {
  const events = await loadJSON<EventsIndexEvent[]>("/events.json");
  if (!events || !Array.isArray(events)) return [];

  const catalog: SUCEventCatalog = [];

  for (const ev of events) {
    const loadedRoutes: SUCRoute[] = [];

    for (const routeRef of ev.routes) {
      const route = await loadRoute(routeRef);
      if (route) loadedRoutes.push(route);
    }

    // Deterministic route ordering:
    //   1) Shortest distance first
    //   2) If tie → alphabetical label
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
      eventStartLocation: ev.eventStartLocation, // 👈 wired through
      routes: loadedRoutes,
    });
  }

  // Deterministic event ordering
  catalog.sort((a, b) => a.eventId.localeCompare(b.eventId));

  return catalog;
}
