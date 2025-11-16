import { } from "react";
import type { SUCEvent, SUCRoute } from "../data/loadEvents";

interface Props {
  events: SUCEvent[];
  activeEvent: SUCEvent | null;
  selectedRoute: SUCRoute | null;
  onEventSelect: (ev: SUCEvent) => void;
  onRouteSelect: (route: SUCRoute) => void;
}

export default function EventSwitcher({
  events,
  activeEvent,
  selectedRoute,
  onEventSelect,
  onRouteSelect,
}: Props) {
  return (
    <div className="h-full w-80 bg-black text-white overflow-y-auto p-4 space-y-6 border-r border-neutral-800">
      {/* Event List */}
      <div>
        <h2 className="text-xl font-semibold mb-3">Events</h2>
        <div className="space-y-2">
          {events.map((ev) => {
            const isActive = activeEvent?.eventId === ev.eventId;
            return (
              <button
                key={ev.eventId}
                onClick={() => onEventSelect(ev)}
                className={`w-full text-left p-3 rounded-xl border transition duration-150 ${
                  isActive
                    ? "bg-neutral-800 border-accent-2 shadow-lg shadow-accent-2/20"
                    : "bg-neutral-900 border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
                }`}
              >
                <div className="font-medium text-base">{ev.eventName}</div>
                {ev.eventDescription && (
                  <div className="text-sm text-neutral-400 mt-1 line-clamp-2">
                    {ev.eventDescription}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Route List */}
      {activeEvent && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Routes</h2>
          <div className="space-y-2">
            {activeEvent.routes.map((route) => {
              const isSelected = selectedRoute?.id === route.id;
              return (
                <button
                  key={route.id}
                  onClick={() => onRouteSelect(route)}
                  className={`w-full text-left p-3 rounded-xl border flex flex-col transition duration-150 ${
                    isSelected
                      ? "bg-neutral-800 border-accent-3 shadow-lg shadow-accent-3/20"
                      : "bg-neutral-900 border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div
                      className="font-medium"
                      style={{ color: route.color }}
                    >
                      {route.name}
                    </div>
                    <span className="text-xs text-neutral-400 tracking-wide">
                      {route.label}
                    </span>
                  </div>

                  {route.description && (
                    <div className="text-sm text-neutral-400 mb-1 line-clamp-2">
                      {route.description}
                    </div>
                  )}

                  <div className="text-xs text-neutral-500">
                    {route.distanceMi.toFixed(1)} mi · {Math.round(route.elevationFt)} ft
                  </div>

                  <a
                    href={route.gpxUrl}
                    download
                    className="text-xs mt-2 text-accent-2 hover:underline self-start"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Download GPX
                  </a>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}