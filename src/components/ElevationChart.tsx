// src/components/ElevationChart.tsx
//
// Elevation profile for the selected SUC route.
// Converts stored meter-based series into:
//   • miles (x-axis)
//   • feet (y-axis, rounded)

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
}

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip, Filler);

const METERS_PER_MILE = 1609.34;
const FEET_PER_METER = 3.28084;

const ElevationChart: FC<ElevationChartProps> = ({ route }) => {
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

    // Convert meters → miles / feet
    const distMi = distM.map((m) =>
      Number.isFinite(m) ? (m as number) / METERS_PER_MILE : m,
    );
    const elevFt = elevM.map((m) =>
      Number.isFinite(m) ? Math.round((m as number) * FEET_PER_METER) : m,
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

    const labels = distMi.map((d) =>
      Number.isFinite(d) ? Number((d as number).toFixed(1)) : d,
    );

    const chartData: ChartData<"line"> = {
      labels,
      datasets: [
        {
          label: "Elevation",
          data: elevFt,
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 6,
          backgroundColor: route.color
            ? toRgba(route.color, 0.25)
            : "rgba(255,0,255,0.25)",
          borderColor: route.color ?? "#ff00ff",
        },
      ],
    };

    const chartOptions: ChartOptions<"line"> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
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
        mode: "index",
        intersect: false,
      },
    };

    return { data: chartData, options: chartOptions, hasSeries: true };
  }, [route]);

  return (
    <div className="suc-elevation-card">
      <div className="suc-elevation-header">
        <div className="suc-elevation-title">
          Elevation Profile
          {route && (
            <span className="suc-elevation-meta">
              {route.distanceMi.toFixed(1)} mi ·{" "}
              {Math.round(route.elevationFt).toLocaleString()} ft gain
            </span>
          )}
        </div>
      </div>

      {!route && (
        <div className="suc-elevation-empty">
          Select a route to view its elevation profile.
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

function toRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
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
