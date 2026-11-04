"use client";

import { useState } from "react";
import { QuestForm } from "./QuestForm";
import { QuestCard } from "./QuestCard";
import type { QuestRequest, QuestResponse } from "@/lib/quest/schema";

export function QuestBuilder() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuestResponse | null>(null);

  async function generate(req: QuestRequest) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setResult(json as QuestResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <QuestForm onSubmit={generate} loading={loading} />
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">Quest generation failed</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs opacity-80">
            Check <code>/api/health</code>, or set <code>QUEST_MOCK=1</code> to develop the UI without backends.
          </p>
        </div>
      )}
      {result && <QuestCard data={result} />}
    </div>
  );
}
