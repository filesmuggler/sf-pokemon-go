"use client";

import { useState } from "react";
import { SF_NEIGHBORHOODS } from "@/lib/quest/neighborhoods";
import type { QuestRequest } from "@/lib/quest/schema";

interface Props {
  onSubmit: (req: QuestRequest) => void;
  loading: boolean;
}

export function QuestForm({ onSubmit, loading }: Props) {
  const [selected, setSelected] = useState<string>(SF_NEIGHBORHOODS[0].slug);
  const [custom, setCustom] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(1200);
  const [days, setDays] = useState(90);
  const [geoError, setGeoError] = useState<string | null>(null);

  const hood = SF_NEIGHBORHOODS.find((n) => n.slug === selected) ?? SF_NEIGHBORHOODS[0];

  function useMyLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCustom({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setSelected("");
      },
      (err) => setGeoError(err.message),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const center = custom ?? { lat: hood.lat, lon: hood.lon };
    onSubmit({
      lat: center.lat,
      lon: center.lon,
      radius_m: radius,
      days,
      neighborhood_hint: custom ? undefined : hood.name,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <label className="mb-2 block text-sm font-medium">Start zone</label>
        <div className="flex flex-wrap gap-2">
          {SF_NEIGHBORHOODS.map((n) => (
            <button
              key={n.slug}
              type="button"
              onClick={() => {
                setSelected(n.slug);
                setCustom(null);
              }}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                selected === n.slug
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-300 hover:border-emerald-500 dark:border-zinc-700"
              }`}
            >
              {n.name}
            </button>
          ))}
          <button
            type="button"
            onClick={useMyLocation}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              custom ? "border-emerald-600 bg-emerald-600 text-white" : "border-dashed border-zinc-400 hover:border-emerald-500"
            }`}
          >
            📍 Use my location
          </button>
        </div>
        {custom && (
          <p className="mt-2 text-xs text-zinc-500">
            {custom.lat.toFixed(5)}, {custom.lon.toFixed(5)}
          </p>
        )}
        {geoError && <p className="mt-2 text-xs text-red-600">{geoError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Walk radius: {radius} m</span>
          <input type="range" min={300} max={2500} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full" />
          <span className="text-xs text-zinc-500">~{Math.round(radius / 80)} min walk</span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Look back: {days} days</span>
          <input type="range" min={30} max={360} step={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full" />
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Agent is investigating 311 reports…" : "Generate side quest"}
      </button>
    </form>
  );
}
