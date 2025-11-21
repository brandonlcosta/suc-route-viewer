/**
 * src/data/loadEvents.ts — SUC HQ Unified Loader (v2.3)
 *
 * Responsibilities:
 *  - Load multi-event catalog (/events.json)
 *  - Load per-route stats JSON + GeoJSON linework
 *  - Normalize into strict SUCEvent / SUCRoute structures
 *  - Provide safe, deterministic ordering every time
 *
 * Notes:
 *  - Frontend-only loader (no server).
 *  - Fails gracefully on missing files.
 *  - Compatible with the Unified Route Map + Elevation engine.
 */

//
// ─────────────────────────────────────────────────────────────
// Types exposed to application
// ─────────────────────────────────────────────────────────────
//

// Stable SUC route labels
export type RouteLabel = "MED" | "LRG" | "XL" | "XXL";

// Single source of truth for neon colors
export const ROUTE_COLORS: Record<RouteLabel, string> = {
  MED: "#00FF99", // neon green
  LRG: "#13FFE2", // neon blue
  XL:  "#D000FF", // purple
  XXL: "#FF5050", // red/orange
};


export interface SUCRoute {
  id: string;
  label: RouteLabel;  // 👈 now using the shared type
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

  // Explicit start location fields (match events.json)
  startLocationName?: string;
  startLocationUrl?: string;

  routes: SUCRoute[];
}

export type SUCEventCatalog = SUCEvent[];

//
// ─────────────────────────────────────────────────────────────
// Types for raw rows inside /public/events.json
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

  // These match the keys in public/events.json
  startLocationName?: string;
  startLocationUrl?: string;

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
// Normalize route labels → strict MED / LRG / XL / XXL
// ─────────────────────────────────────────────────────────────
//

function normalizeLabel(raw: string): RouteLabel {
  const s = raw.toLowerCase();

  if (s.includes("xxl")) return "XXL";
  if (s.includes("xl")) return "XL";
  if (s.includes("lrg") || s.includes("large")) return "LRG";
  if (s.includes("med") || s.includes("medium")) return "MED";

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

  // Use whatever label we can find, normalize it, and drive color from that
  const rawLabel = stats.label || routeMeta.label;
  const label = normalizeLabel(rawLabel);

  return {
    id: stats.id,

    label,
    name: stats.name,
    description: stats.description,

    // 💅 Hard-lock color to label mapping (MED/ LRG / XL / XXL)
    color: ROUTE_COLORS[label],

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
// Helpers for event ordering (newest → oldest)
// ─────────────────────────────────────────────────────────────
//

function extractEventNumber(eventId: string): number | null {
  const numeric = eventId.replace(/\D/g, "");
  if (!numeric) return null;
  const parsed = parseInt(numeric, 10);
  return Number.isNaN(parsed) ? null : parsed;
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
      startLocationName: ev.startLocationName,
      startLocationUrl: ev.startLocationUrl,
      routes: loadedRoutes,
    });
  }

  // Deterministic event ordering:
  //   - Newest → oldest using numeric portion of eventId (e.g. "SUC 024" → 24)
  //   - If numeric parse fails, fall back to descending lexicographic order
  catalog.sort((a, b) => {
    const numA = extractEventNumber(a.eventId);
    const numB = extractEventNumber(b.eventId);

    if (numA != null && numB != null && numA !== numB) {
      return numB - numA; // highest number (newest) first
    }

    // Fallback: reverse lexicographic so "SUC 024" still comes before "SUC 023"
    return b.eventId.localeCompare(a.eventId);
  });

  return catalog;
}
