/**
 * scripts/convert-gpx-to-geojson.mjs — SUC Route Builder v4 (with simplification)
 *
 * Purpose:
 *  - Scan /public/gpx/<eventId>/ directories
 *  - Optionally read event.json metadata per event
 *  - Convert GPX → GeoJSON
 *  - Compute distance, elevation, and profile series
 *  - ***NEW:*** Simplify + quantize route geometry to reduce file size & load time
 *  - Generate:
 *      /public/routes/<routeId>.geojson
 *      /public/routes/<routeId>.json
 *
 * IMPORTANT:
 *  - This version does NOT write /public/events.json.
 *    You maintain events.json manually.
 *
 * Requirements:
 *  - Node 18+
 *  - npm i @tmcw/togeojson xmldom
 */

import fs from "fs";
import path from "path";
import { DOMParser } from "xmldom";
import { gpx } from "@tmcw/togeojson";

/* ------------------------------------------------------
   PATH CONSTANTS
------------------------------------------------------ */

const ROOT_DIR = path.resolve(process.cwd(), "public");
const GPX_DIR = path.join(ROOT_DIR, "gpx");
const ROUTES_OUT = path.join(ROOT_DIR, "routes");

// Ensure output directory exists
if (!fs.existsSync(ROUTES_OUT)) {
  fs.mkdirSync(ROUTES_OUT, { recursive: true });
}

/* ------------------------------------------------------
   NEON SUC PALETTE
------------------------------------------------------ */

const COLOR_MAP = {
  MED: "#00FF99",
  LRG: "#13FFE2",
  XL: "#FF47A1",
  XXL: "#9B4DFF",
};

/* ------------------------------------------------------
   UTILITIES
------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON + file write with retry, so Windows / FS locks don’t freak out.
 */
async function writeAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.promises.writeFile(tmpPath, json, "utf-8");
      await fs.promises.rename(tmpPath, filePath);
      return;
    } catch (err) {
      const code = err && err.code;
      const isLockError = code === "EPERM" || code === "EBUSY";

      if (!isLockError || attempt === maxAttempts) {
        try {
          if (fs.existsSync(tmpPath)) {
            await fs.promises.unlink(tmpPath);
          }
        } catch {
          // ignore cleanup errors
        }
        throw err;
      }

      const delay = 150 * attempt;
      console.warn(
        `⚠ writeAtomic lock error on ${filePath} (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms…`
      );
      await sleep(delay);
    }
  }
}

/**
 * Haversine distance (meters) between two [lon, lat] pairs.
 */
function haversine(a, b) {
  const R = 6371000; // meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const sLat1 = toRad(lat1);
  const sLat2 = toRad(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(sLat1) * Math.cos(sLat2) * sinDLon * sinDLon;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Compute distance / elevation profile from coordinate + elevation series.
 *
 * coords: [ [lon, lat], ... ]
 * elevations: [ meters, ... ]
 */
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

/**
 * NEW: Downsample track by keeping points at least `minStepMeters` apart.
 * This is the main way we shrink file size / lighten the map.
 */
function simplifyTrack(coords, elevations, minStepMeters = 15) {
  if (coords.length <= 2) {
    return { coords, elevations };
  }

  const simplifiedCoords = [coords[0]];
  const simplifiedElevs = [elevations[0]];
  let lastKept = coords[0];

  for (let i = 1; i < coords.length - 1; i++) {
    const d = haversine(lastKept, coords[i]);
    if (d >= minStepMeters) {
      simplifiedCoords.push(coords[i]);
      simplifiedElevs.push(elevations[i]);
      lastKept = coords[i];
    }
  }

  // Always keep final point
  simplifiedCoords.push(coords[coords.length - 1]);
  simplifiedElevs.push(elevations[elevations.length - 1]);

  return { coords: simplifiedCoords, elevations: simplifiedElevs };
}

/**
 * NEW: Quantize coordinates to a fixed decimal precision
 * to shrink JSON text size without changing shape visually.
 */
function quantizeCoords(coords, decimals = 5) {
  return coords.map(([lon, lat]) => [
    Number(lon.toFixed(decimals)),
    Number(lat.toFixed(decimals)),
  ]);
}

/* ------------------------------------------------------
   CORE: GPX → simplified GeoJSON + stats
------------------------------------------------------ */

/**
 * Process one route file within an event.
 *
 * eventId   — folder name under /public/gpx/
 * routeFile — filename like "SUC024_MED.gpx"
 * eventMeta — data from event.json (optional)
 */
async function processRoute(eventId, routeFile, eventMeta = {}) {
  const fullPath = path.join(GPX_DIR, eventId, routeFile);

  const xmlStr = await fs.promises.readFile(fullPath, "utf-8");
  const dom = new DOMParser().parseFromString(xmlStr, "text/xml");

  const geo = gpx(dom);
  const feats = geo.features.filter(
    (f) => f.geometry && f.geometry.type === "LineString"
  );

  if (feats.length === 0) {
    console.warn(`⚠ No LineString found in ${routeFile}`);
    return null;
  }

  // Flatten all coordinates and elevations into a single track
  const allCoords = [];
  const allElevs = [];

  for (const f of feats) {
    for (const coord of f.geometry.coordinates) {
      const [lon, lat, ele] = coord;
      allCoords.push([lon, lat]);
      allElevs.push(ele ?? 0);
    }
  }

  if (allCoords.length < 2) {
    console.warn(`⚠ Not enough coordinates in ${routeFile}`);
    return null;
  }

  // 🔥 NEW: simplify + quantize before computing stats / writing
  const { coords: simpCoords, elevations: simpElevs } = simplifyTrack(
    allCoords,
    allElevs,
    15 // meters between kept points — tweak this for more/less detail
  );

  const quantizedCoords = quantizeCoords(simpCoords, 5);
  const stats = computeProfile(quantizedCoords, simpElevs);

  // Determine route label from filename (MED/LRG/XL/XXL)
  const labelMatch = routeFile.match(/(MED|LRG|XL|XXL)/i);
  const label = labelMatch ? labelMatch[1].toUpperCase() : "MED";

  const baseId = routeFile.replace(/\.gpx$/i, "");
  const id = baseId;

  const routeMeta =
    eventMeta.routes && typeof eventMeta.routes === "object"
      ? eventMeta.routes[label] ?? {}
      : {};

  const color = routeMeta.color || COLOR_MAP[label] || COLOR_MAP.MED;

  const name = routeMeta.name || `${label} Route`;
  const description = routeMeta.description || "";

  // URLs as seen by the frontend (relative to /public root)
  const gpxUrl = `/gpx/${eventId}/${routeFile}`;
  const geojsonUrl = `/routes/${id}.geojson`;
  const statsUrl = `/routes/${id}.json`;

  // GeoJSON with color baked in props
  const geoOut = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id, label, color },
        geometry: {
          type: "LineString",
          coordinates: quantizedCoords,
        },
      },
    ],
  };

  await writeAtomic(path.join(ROUTES_OUT, `${id}.geojson`), geoOut);

  // Stats JSON consumed by the frontend loader
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

  await writeAtomic(path.join(ROUTES_OUT, `${id}.json`), statsOut);

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

/* ------------------------------------------------------
   EVENT-LEVEL PROCESSOR
------------------------------------------------------ */

/**
 * Process one event folder: /public/gpx/<eventId>/
 *
 * - event.json is OPTIONAL
 *   If present, it can override:
 *   {
 *     routes: {
 *       MED: { name, description, color },
 *       ...
 *     }
 *   }
 */
async function processEvent(eventId) {
  const eventDir = path.join(GPX_DIR, eventId);
  const metaPath = path.join(eventDir, "event.json");

  let meta = {};

  if (fs.existsSync(metaPath)) {
    try {
      const raw = await fs.promises.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `⚠ Failed to parse event.json in ${eventId}: ${err.message}`
      );
      meta = {};
    }
  } else {
    console.log(`ℹ No event.json in ${eventId}, using defaults.`);
  }

  const files = await fs.promises.readdir(eventDir);
  const gpxFiles = files
    .filter((f) => f.toLowerCase().endsWith(".gpx"))
    .sort();

  if (gpxFiles.length === 0) {
    console.warn(`⚠ No GPX files found in ${eventId}`);
    return 0;
  }

  let count = 0;
  for (const f of gpxFiles) {
    const out = await processRoute(eventId, f, meta);
    if (out) count++;
  }

  return count;
}

/* ------------------------------------------------------
   MAIN
------------------------------------------------------ */

(async () => {
  if (!fs.existsSync(GPX_DIR)) {
    console.error("❌ GPX directory does not exist:", GPX_DIR);
    process.exit(1);
  }

  const entries = await fs.promises.readdir(GPX_DIR, { withFileTypes: true });
  const eventFolders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (eventFolders.length === 0) {
    console.warn("⚠ No event folders found under:", GPX_DIR);
    process.exit(0);
  }

  let totalEvents = 0;
  let totalRoutes = 0;

  for (const ev of eventFolders) {
    const count = await processEvent(ev);
    if (count > 0) {
      totalEvents++;
      totalRoutes += count;
      console.log(`✔ Processed ${ev}: ${count} routes`);
    }
  }

  console.log("✔ GPX conversion complete.");
  console.log(`✔ Events processed: ${totalEvents}`);
  console.log(`✔ Routes generated: ${totalRoutes}`);
})();
