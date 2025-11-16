// src/eventData.ts
// SUC-023 event definitions (REAL FILE MODE — no placeholders)

// Each route points to real GPX + real GeoJSON you will upload into /public.
// The map will load ONLY when your actual files exist.

export interface RouteDefinition {
  id: string;            // Route key (e.g. SUC-023-MED)
  name: string;          // Display name
  distanceMi: number;    // Miles
  elevationFt: number;   // Feet
  color: string;         // Route color for map + UI
  gpxUrl: string;        // "/gpx/<filename>.gpx"
  geojsonUrl: string;    // "/routes/<filename>.geojson"
}

export interface EventDefinition {
  id: string;            // "suc_023"
  name: string;          // Full event title
  description: string;   // Short blurb
  routes: RouteDefinition[];
}

// -----------------------------------------------------------
// SUC-023 — REAL DATA MODE
// (GeoJSON + GPX loaded dynamically by the map, not inline)
// -----------------------------------------------------------

export const currentEvent: EventDefinition = {
  id: "suc_023",
  name: "SUC-023 – Multi-Route Night",
  description:
    "Live viewer for SUC-023 route sets. Real GPX + GeoJSON required for map rendering.",
  routes: [
    {
      id: "SUC-023-MED",
      name: "MED Route",
      distanceMi: 10,       // update when you have the real number
      elevationFt: 800,     // update when you have the real number
      color: "#00ffff",
      gpxUrl: "/gpx/SUC-023-MED.gpx",
      geojsonUrl: "/routes/SUC-023-MED.geojson",
    },
    {
      id: "SUC-023-LRG",
      name: "LRG Route",
      distanceMi: 15,
      elevationFt: 1400,
      color: "#ff00ff",
      gpxUrl: "/gpx/SUC-023-LRG.gpx",
      geojsonUrl: "/routes/SUC-023-LRG.geojson",
    },
    {
      id: "SUC-023-XL",
      name: "XL Route",
      distanceMi: 20,
      elevationFt: 2200,
      color: "#ffcc00",
      gpxUrl: "/gpx/SUC-023-XL.gpx",
      geojsonUrl: "/routes/SUC-023-XL.geojson",
    },
    {
      id: "SUC-023-XXL",
      name: "XXL Route",
      distanceMi: 30,
      elevationFt: 3200,
      color: "#00ff88",
      gpxUrl: "/gpx/SUC-023-XXL.gpx",
      geojsonUrl: "/routes/SUC-023-XXL.geojson",
    },
  ],
};
