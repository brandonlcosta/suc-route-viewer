// src/components/ElevationChart.tsx
//
// Purpose:
//   Render an elevation profile for the currently selected SUC route.
//
// Inputs:
//   - route: SUCRoute | null (from data/loadEvents), optionally carrying
//     distanceSeries & elevationSeries for the chart.
//
// Outputs:
//   - A compact inline Line chart rendered inside `.suc-elevation-card`.
//   - Graceful empty states if series data is missing.

import { useMemo } from "react";
import type { FC } from "react";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { SUCRoute as LoaderRoute } from "../data/loadEvents";

type RouteWithSeries = LoaderRoute & {
  distanceSeries?: number[];
  elevationSeries?: number[];
};

export interface ElevationChartProps {
  route: RouteWithSeries | null;
}

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
);

const ElevationChart: FC<ElevationChartProps> = ({ route }) => {
  const { data, options, hasSeries } = useMemo(() => {
    if (!route) {
      return { data: undefined, options: undefined, hasSeries: false };
    }

    const distanceSeries = route.distanceSeries ?? [];
    const elevationSeries = route.elevationSeries ?? [];

    const validSeries =
      distanceSeries.length > 1 &&
      distanceSeries.length === elevationSeries.length;

    if (!validSeries) {
      return { data: undefined, options: undefined, hasSeries: false };
    }

    const labels = distanceSeries.map((d) =>
      Number.isFinite(d) ? Number(d.toFixed(1)) : d
    );

    const chartData = {
      labels,
      datasets: [
        {
          label: "Elevation",
          data: elevationSeries,
          borderColor: route.color || "#00ffff",
          backgroundColor: route.color
            ? toRgba(route.color, 0.2)
            : "rgba(0, 255, 255, 0.2)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 6,
        },
      ],
    };

    const chartOptions: Parameters<typeof Line>[0]["options"] = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => {
              const distance = ctx.label;
              const elevation = ctx.parsed.y;
              return ` ${distance} • ${elevation} ft`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Distance",
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 8,
          },
          grid: {
            display: false,
          },
        },
        y: {
          title: {
            display: true,
            text: "Elevation",
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
          },
          grid: {},
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
  const normalized = hex.trim().replace("#", "");
  if (normalized.length !== 3 && normalized.length !== 6) {
    return `rgba(0, 255, 255, ${alpha})`;
  }

  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  if (
    Number.isNaN(r) ||
    Number.isNaN(g) ||
    Number.isNaN(b) ||
    alpha < 0 ||
    alpha > 1
  ) {
    return `rgba(0, 255, 255, ${alpha})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default ElevationChart;
