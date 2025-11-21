// src/components/ElevationChart.tsx
//
// Elevation chart for the selected SUC route, with a single
// playback dot that moves smoothly along the profile in sync
// with playbackProgress.

import { useMemo } from "react";
import type { FC } from "react";

import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Filler,
} from "chart.js";

import type { ChartOptions, ChartData } from "chart.js";
import { Line } from "react-chartjs-2";

import type { SUCRoute as LoaderRoute } from "../data/loadEvents";

type RouteWithSeries = LoaderRoute & {
  distanceSeries?: number[];
  elevationSeries?: number[];
};

export interface ElevationChartProps {
  route: RouteWithSeries | null;
  /** 0–1 normalized playback position along the route */
  playbackProgress?: number;
}

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip, Filler);

const METERS_PER_MILE = 1609.34;
const FEET_PER_METER = 3.28084;

const ElevationChart: FC<ElevationChartProps> = ({
  route,
  playbackProgress,
}) => {
  const { data, options, hasSeries } = useMemo(() => {
    if (!route) {
      return {
        data: undefined as ChartData<"line"> | undefined,
        options: undefined as ChartOptions<"line"> | undefined,
        hasSeries: false,
      };
    }

    const distM = route.distanceSeries ?? [];
    const elevM = route.elevationSeries ?? [];

    const elevFt = elevM.map((m) =>
      Number.isFinite(m) ? Math.round((m as number) * FEET_PER_METER) : m
    );
    const distMi = distM.map((m) =>
      Number.isFinite(m) ? (m as number) / METERS_PER_MILE : m
    );

    const validSeries =
      distMi.length > 1 && distMi.length === elevFt.length;

    if (!validSeries) {
      return {
        data: undefined,
        options: undefined,
        hasSeries: false,
      };
    }

    // --- Base XY points for the elevation profile ---
    const basePoints = distMi.map((d, i) => ({
      x: Number.isFinite(d) ? (d as number) : 0,
      y: elevFt[i] as number,
    }));

    const datasets: ChartData<"line">["datasets"] = [
      {
        label: "Elevation",
        data: basePoints,
        fill: true,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 6,
        backgroundColor: route.color
          ? toRgba(route.color, 0.22)
          : "rgba(255,0,255,0.22)",
        borderColor: route.color ?? "#00ff99",
      },
    ];

    // --- Single playback dot aligned with the profile (interpolated) ---
    if (
      typeof playbackProgress === "number" &&
      playbackProgress >= 0 &&
      playbackProgress <= 1 &&
      elevFt.length > 1
    ) {
      const maxIndex = elevFt.length - 1;
      const scaled = playbackProgress * maxIndex;
      const i0 = Math.floor(scaled);
      const i1 = Math.min(i0 + 1, maxIndex);
      const t = scaled - i0;

      const x0 = distMi[i0] as number;
      const x1 = distMi[i1] as number;
      const y0 = elevFt[i0] as number;
      const y1 = elevFt[i1] as number;

      const x = lerp(x0, x1, t);
      const y = lerp(y0, y1, t);

      datasets.push({
        label: "Playback Dot",
        data: [{ x, y }],
        showLine: false,
        borderWidth: 0,
        pointRadius: 5,
        pointHoverRadius: 6,
        pointHitRadius: 8,
        pointBackgroundColor: route.color ?? "#ffe76a",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      } as any);
    }

    const chartData: ChartData<"line"> = {
      // labels are optional when using XY points; keeps tooltip distance nice
      labels: distMi.map((d) =>
        Number.isFinite(d) ? Number((d as number).toFixed(1)) : d
      ),
      datasets,
    };

    const chartOptions: ChartOptions<"line"> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "nearest",
          intersect: false,
          callbacks: {
            label: (ctx: any) => {
              const xRaw = ctx.parsed?.x;
              const yRaw = ctx.parsed?.y;

              const distance =
                typeof xRaw === "number" ? xRaw.toFixed(1) : "0";
              const elevation =
                typeof yRaw === "number" ? Math.round(yRaw) : 0;

              return ` ${distance} mi • ${elevation} ft`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Distance (mi)",
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
          },
          grid: { display: false },
        },
        y: {
          title: {
            display: true,
            text: "Elevation (ft)",
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 4,
          },
        },
      },
      interaction: {
        mode: "nearest",
        intersect: false,
      },
    };

    return { data: chartData, options: chartOptions, hasSeries: true };
  }, [route, playbackProgress]);

  return (
    <div className="suc-elevation-card">
      <div className="suc-elevation-header">
        {route && (
          <div className="suc-elevation-title">
            <span className="suc-elevation-meta">
              {route.distanceMi.toFixed(1)} mi ·{" "}
              {Math.round(route.elevationFt).toLocaleString()} ft gain
            </span>
          </div>
        )}
      </div>

      {!route && (
        <div className="suc-elevation-empty">
          Select a route to view its elevation.
        </div>
      )}

      {route && !hasSeries && (
        <div className="suc-elevation-empty">
          Elevation data is not available for this route.
        </div>
      )}

      {route && hasSeries && data && options && (
        <div className="suc-elevation-chart-shell">
          <Line data={data} options={options} />
        </div>
      )}
    </div>
  );
};

// Linear interpolation helper
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Safe hex → rgba converter
function toRgba(hex: string, alpha: number): string {
  const cleaned = hex.trim().replace("#", "");
  if (cleaned.length !== 3 && cleaned.length !== 6)
    return `rgba(0,255,255,${alpha})`;

  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);

  if ([r, g, b].some((n) => Number.isNaN(n)))
    return `rgba(0,255,255,${alpha})`;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default ElevationChart;
