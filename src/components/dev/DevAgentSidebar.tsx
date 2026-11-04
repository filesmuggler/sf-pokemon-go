"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentStep } from "@/lib/quest/schema";

/**
 * Dev-only sidebar: chat with the exemplary dataset in the dev Elastic
 * project through the Mistral agent. Shows every query the agent ran and
 * its raw result, so we can learn which queries/interfaces the production
 * agent needs before real data is loaded.
 */

interface Status {
  enabled: boolean;
  host: string | null;
  mistral: boolean;
  model: string;
  connected: boolean;
  indices: { index: string; docs: number }[];
  error?: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  trace?: AgentStep[];
  ms?: number;
  error?: boolean;
}

const STORAGE_KEY = "sfq:dev-agent:chat";

function starterPrompts(status: Status | null): string[] {
  const first = status?.indices[0]?.index;
  return [
    "What indices are available and how big are they?",
    first ? `Describe the fields in ${first} and show 3 sample documents.` : "Show me the mapping of the main index.",
    first ? `Give me a breakdown of ${first} by its main keyword field, with counts.` : "Count documents per category.",
    "Write an ES|QL query that computes averages per category and run it.",
    "Which query patterns from this dataset will carry over to the SF 311 index?",
  ];
}

/** Minimal renderer: fenced code → <pre>, everything else pre-wrapped text. */
function Markdownish({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose?.trim()) nodes.push(<p key={`p${i}`} className="whitespace-pre-wrap">{prose.trim()}</p>);
    const lang = parts[i + 1];
    const code = parts[i + 2];
    if (code !== undefined) {
      nodes.push(
        <pre key={`c${i}`} className="overflow-x-auto rounded-md bg-zinc-950 p-2 text-[11px] leading-snug text-emerald-200">
          {lang && <span className="mb-1 block text-[10px] uppercase text-zinc-500">{lang}</span>}
          {code.trimEnd()}
        </pre>,
      );
    }
  }
  return <div className="space-y-2">{nodes}</div>;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function TraceStep({ step, index }: { step: AgentStep; index: number }) {
  const [open, setOpen] = useState(false);
  const args = JSON.stringify(step.args, null, 2);
  const result = step.result === undefined ? null : JSON.stringify(step.result, null, 2);
  const failed = step.result_summary.startsWith("error");
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-900/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]">
        <span className="text-zinc-500">{index + 1}.</span>
        <span className={`font-mono font-semibold ${failed ? "text-red-400" : "text-emerald-400"}`}>{step.tool}</span>
        <span className="flex-1 truncate text-zinc-400">→ {step.result_summary}</span>
        <span className="text-zinc-500">{step.ms} ms</span>
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 p-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase text-zinc-500">
              <span>query / args</span>
              <CopyButton value={args} />
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 text-[11px] text-sky-200">{args}</pre>
          </div>
          {result && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase text-zinc-500">
                <span>result</span>
                <CopyButton value={result} />
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-zinc-950 p-2 text-[11px] text-zinc-300">{result}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const [showTrace, setShowTrace] = useState(true);
  if (turn.role === "user") {
    return (
      <div className="ml-8 rounded-xl bg-emerald-700/80 px-3 py-2 text-sm text-white">
        <p className="whitespace-pre-wrap">{turn.content}</p>
      </div>
    );
  }
  return (
    <div className={`mr-4 rounded-xl border px-3 py-2 text-sm ${turn.error ? "border-red-800 bg-red-950/40 text-red-200" : "border-zinc-800 bg-zinc-900 text-zinc-100"}`}>
      <Markdownish text={turn.content} />
      {turn.trace && turn.trace.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-2">
          <button type="button" onClick={() => setShowTrace((s) => !s)} className="text-[11px] text-zinc-400 hover:text-zinc-200">
            {showTrace ? "▾" : "▸"} {turn.trace.length} tool call{turn.trace.length === 1 ? "" : "s"}
            {turn.ms ? ` · ${(turn.ms / 1000).toFixed(1)} s` : ""}
          </button>
          {showTrace && (
            <ol className="mt-2 space-y-1">
              {turn.trace.map((s, i) => (
                <TraceStep key={i} step={s} index={i} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function DevAgentSidebar() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const restored = useRef(false);

  function toggle() {
    // Restore conversation across reloads (HMR-friendly) the first time the drawer opens.
    if (!restored.current) {
      restored.current = true;
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) setTurns(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* ignore */
    }
  }, [turns]);

  useEffect(() => {
    if (!open || status) return;
    fetch("/api/dev/chat")
      .then((r) => r.json())
      .then((s: Status) => setStatus(s))
      .catch((err) => setStatus({ enabled: true, host: null, mistral: false, model: "?", connected: false, indices: [], error: String(err) }));
  }, [open, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/dev/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((t) => !t.error).map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setTurns([...next, { role: "assistant", content: json.reply, trace: json.trace, ms: json.ms }]);
    } catch (err) {
      setTurns([...next, { role: "assistant", content: err instanceof Error ? err.message : String(err), error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 shadow-lg hover:border-emerald-500"
        title="Dev agent — chat with the data"
      >
        🛠 Dev agent
      </button>

      {open && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
          <header className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Dev agent · read-only</p>
                <h2 className="text-sm font-semibold">Chat with the data</h2>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setTurns([])} className="text-xs text-zinc-400 hover:text-zinc-200" disabled={turns.length === 0}>
                  clear
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded px-2 text-zinc-400 hover:text-zinc-100" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {status ? (
                <>
                  <span className={`rounded-full px-2 py-0.5 ${status.connected ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/60 text-red-300"}`}>
                    {status.connected ? "● elastic" : "○ elastic"} {status.host ?? "not configured"}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${status.mistral ? "bg-zinc-800 text-zinc-300" : "bg-red-900/60 text-red-300"}`}>
                    {status.model}
                  </span>
                  {status.indices.map((i) => (
                    <button
                      key={i.index}
                      type="button"
                      onClick={() => send(`Describe the index ${i.index}: fields, types and a few sample documents.`)}
                      className="rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-zinc-300 hover:border-emerald-500"
                      title="Ask the agent to describe this index"
                    >
                      {i.index} <span className="text-zinc-500">{i.docs}</span>
                    </button>
                  ))}
                  {status.error && <span className="w-full text-red-400">{status.error}</span>}
                </>
              ) : (
                <span className="text-zinc-500">connecting…</span>
              )}
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">
                  Ask anything about the data. The agent will inspect mappings, build Query DSL / aggregations / ES|QL, run them read-only, and
                  show you every query it executed.
                </p>
                <ul className="space-y-1">
                  {starterPrompts(status).map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => send(p)}
                        className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-left text-xs text-zinc-300 hover:border-emerald-500 hover:text-white"
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turns.map((t, i) => (
              <Turn key={i} turn={t} />
            ))}
            {busy && (
              <div className="mr-4 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
                <span className="animate-pulse">Agent is querying Elasticsearch…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-zinc-800 p-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder="Ask about the data… (Enter to send, Shift+Enter for newline)"
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              disabled={busy}
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Dev only · not shipped to production</span>
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}
