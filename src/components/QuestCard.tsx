import type { Objective, Problem, QuestResponse } from "@/lib/quest/schema";

const OBJECTIVE_ICON: Record<Objective["type"], string> = {
  visit: "🧭",
  photo: "📸",
  verify: "🔍",
  report: "📝",
  propose: "💡",
};

const IMPACT_STYLE = {
  low: "bg-zinc-200 text-zinc-800",
  medium: "bg-amber-200 text-amber-900",
  high: "bg-emerald-200 text-emerald-900",
} as const;

function ProblemItem({ problem }: { problem: Problem }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-semibold">{problem.title}</h4>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{problem.category}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{problem.description}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
          <dt className="text-zinc-500">Reports</dt>
          <dd className="text-lg font-bold">{problem.occurrences}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
          <dt className="text-zinc-500">Dupes removed</dt>
          <dd className="text-lg font-bold">{problem.duplicates_removed}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
          <dt className="text-zinc-500">Open / Closed</dt>
          <dd className="text-lg font-bold">
            <span className="text-red-600">{problem.open_count}</span> / <span className="text-emerald-600">{problem.closed_count}</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        📍 {problem.location.label}
        {problem.recurring_since && <> · recurring since {problem.recurring_since.slice(0, 10)}</>}
      </p>
      <p className="mt-1 font-mono text-[11px] text-zinc-400">cases: {problem.case_ids.join(", ")}</p>
    </li>
  );
}

export function QuestCard({ data }: { data: QuestResponse }) {
  const { quest, trace, model, mock } = data;
  return (
    <article className="flex flex-col gap-6">
      <header className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg">
        <p className="text-xs uppercase tracking-widest opacity-80">
          Side quest · {quest.neighborhood} · {quest.radius_m} m radius
          {mock && " · MOCK DATA"}
        </p>
        <h2 className="mt-1 text-2xl font-bold">{quest.title}</h2>
        <p className="mt-3 text-sm leading-relaxed opacity-95">{quest.summary}</p>
        <p className="mt-4 inline-block rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">⭐ {quest.total_xp} XP available</p>
      </header>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Recurring problems</h3>
        <ul className="grid gap-3 md:grid-cols-3">
          {quest.problems.map((p) => (
            <ProblemItem key={p.id} problem={p} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-5 dark:bg-emerald-950/30">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">💡 Proposed intervention: {quest.intervention.title}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${IMPACT_STYLE[quest.intervention.estimated_impact]}`}>
            {quest.intervention.estimated_impact} impact
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{quest.intervention.rationale}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {quest.intervention.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-zinc-500">Contact: {quest.intervention.who_to_contact}</p>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Objectives</h3>
        <ul className="space-y-2">
          {quest.objectives.map((o) => (
            <li key={o.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <span className="text-2xl">{OBJECTIVE_ICON[o.type]}</span>
              <div className="flex-1">
                <p className="font-medium">{o.title}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">+{o.xp} XP</span>
            </li>
          ))}
        </ul>
      </section>

      <details className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">
          Agent trace · {trace.length} tool calls · {model}
        </summary>
        <ol className="mt-3 space-y-2 font-mono text-xs">
          {trace.map((step, i) => (
            <li key={i} className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
              <div className="flex justify-between">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{step.tool}</span>
                <span className="text-zinc-400">{step.ms} ms</span>
              </div>
              <div className="truncate text-zinc-500">{JSON.stringify(step.args)}</div>
              <div>→ {step.result_summary}</div>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
