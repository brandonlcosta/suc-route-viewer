/**
 * scripts/convert-gpx-to-geojson.mjs
 *
 * Purpose:
 *  - Scan /public/gpx/<eventId>/ directories
 *  - Read event.json metadata per event
 *  - Convert GPX → GeoJSON
 *  - Compute distance, elevation, and profile series
 *  - Generate:
 *      /public/routes/<routeId>.geojson
 *      /public/routes/<routeId>.json
 *  - Generate a global /public/events.json catalog
 *
 * Requirements:
 *  - Node 18+
 *  - npm i @tmcw/togeojson xmldom
 *
 * Deterministic Output:
 *  - Fixed neon SUC palette (MED/LRG/XL/XXL)
 *  - Lexicographic route ordering
 *  - Atomic writes
 */

import fs from "fs";
import path from "path";
import { DOMParser } from "xmldom";
import { gpx } from "@tmcw/togeojson";

// Directories
const ROOT_DIR = path.resolve(process.cwd(), "public");
const GPX_DIR = path.join(ROOT_DIR, "gpx");
const ROUTES_OUT = path.join(ROOT_DIR, "routes");
const EVENTS_OUT = path.join(ROOT_DIR, "events.json");

// Ensure output directory exists
if (!fs.existsSync(ROUTES_OUT)) fs.mkdirSync(ROUTES_OUT, { recursive: true });

// Neon SUC palette (locked in)
const COLOR_MAP = {
  MED: "#00FF99",
  LRG: "#13FFE2",
  XL:  "#FF47A1",
  XXL: "#9B4DFF",
};

// Utility: write JSON atomically
async function writeAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.promises.rename(tmp, filePath);
}

// Haversine distance in meters
function haversine(a, b) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;

  const lat1 = a[1], lon1 = a[0];
  const lat2 = b[1], lon2 = b[0];

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const sLat1 = toRad(lat1);
  const sLat2 = toRad(lat2);

  const aCalc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(aCalc));
}

// Compute distance + elevation profile
function computeProfile(coords, elevations) {
  const distanceSeries = [0];
  let totalDist = 0;

  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    totalDist += d;
    distanceSeries.push(totalDist);
  }

  const elevationSeries = elevations.slice();

  // Elevation gain (meters)
  let elevGain = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) elevGain += diff;
  }

  return {
    distanceSeries,
    elevationSeries,
    distanceKm: totalDist / 1000,
    distanceMi: totalDist / 1609.344,
    elevationM: elevGain,
    elevationFt: elevGain * 3.28084,
  };
}

// Parse a single GPX file → GeoJSON + stats
async function processRoute(eventId, routeFile, eventMeta) {
  const fullPath = path.join(GPX_DIR, eventId, routeFile);

  const xmlStr = await fs.promises.readFile(fullPath, "utf-8");
  const dom = new DOMParser().parseFromString(xmlStr);

  const geo = gpx(dom);
  const feats = geo.features.filter(f => f.geometry.type === "LineString");

  if (feats.length === 0) {
    console.warn(`No LineString found in ${routeFile}`);
    return null;
  }

  // Combine all segments if necessary
  const allCoords = [];
  const allElevs = [];

  feats.forEach(f => {
    f.geometry.coordinates.forEach(([lon, lat, ele]) => {
      allCoords.push([lon, lat]);
      allElevs.push(ele ?? 0);
    });
  });

  // Compute stats
  const stats = computeProfile(allCoords, allElevs);

  // Determine route label from filename (MED/LRG/XL/XXL)
  const labelMatch = routeFile.match(/(MED|LRG|XL|XXL)/i);
  const label = labelMatch ? labelMatch[1].toUpperCase() : "MED";

  const baseId = routeFile.replace(/\.gpx$/i, "");
  const id = baseId;
  const color =
    (eventMeta.routes?.[label]?.color) ||
    COLOR_MAP[label] ||
    COLOR_MAP["MED"];

  const name =
    eventMeta.routes?.[label]?.name ||
    `${label} Route`;

  const description =
    eventMeta.routes?.[label]?.description || "";

  // Paths
  const gpxUrl = `/gpx/${eventId}/${routeFile}`;
  const geojsonUrl = `/routes/${id}.geojson`;
  const statsUrl = `/routes/${id}.json`;

  // Write GeoJSON (with color baked in)
  const geoOut = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id, label, color },
        geometry: {
          type: "LineString",
          coordinates: allCoords,
        },
      },
    ],
  };

  await writeAtomic(
    path.join(ROUTES_OUT, `${id}.geojson`),
    geoOut
  );

  // Write stats JSON
  const statsOut = {
    id,
    label,
    name,
    description,
    color,
    gpxUrl,
    geojsonUrl,
    statsUrl,
    distanceMi: stats.distanceMi,
    distanceKm: stats.distanceKm,
    elevationFt: stats.elevationFt,
    elevationM: stats.elevationM,
    distanceSeries: stats.distanceSeries,
    elevationSeries: stats.elevationSeries,
  };

  await writeAtomic(
    path.join(ROUTES_OUT, `${id}.json`),
    statsOut
  );

  return {
    id,
    label,
    name,
    description,
    color,
    gpxUrl,
    geojsonUrl,
    statsUrl,
  };
}

// Process an entire event folder
async function processEvent(eventId) {
  const eventDir = path.join(GPX_DIR, eventId);
  const metaPath = path.join(eventDir, "event.json");

  if (!fs.existsSync(metaPath)) {
    console.warn(`Missing event.json in ${eventId}`);
    return null;
  }

  const raw = await fs.promises.readFile(metaPath, "utf-8");
  const meta = JSON.parse(raw);

  const files = await fs.promises.readdir(eventDir);
  const gpxFiles = files.filter(f => f.endsWith(".gpx")).sort();

  const routeDefs = [];
  for (const f of gpxFiles) {
    const route = await processRoute(eventId, f, meta);
    if (route) routeDefs.push(route);
  }

  return {
    eventId,
    eventName: meta.eventName || eventId,
    eventDescription: meta.eventDescription || "",
    routes: routeDefs,
  };
}

// Main execution
(async () => {
  const events = [];
  const eventFolders = (await fs.promises.readdir(GPX_DIR))
    .filter(f => fs.lstatSync(path.join(GPX_DIR, f)).isDirectory())
    .sort();

  for (const ev of eventFolders) {
    const out = await processEvent(ev);
    if (out) events.push(out);
  }

  await writeAtomic(EVENTS_OUT, events);

  console.log("✔ GPX conversion complete.");
  console.log(`✔ Processed events: ${events.length}`);
})();
