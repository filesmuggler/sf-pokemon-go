import { z } from "zod";
import { getMistralModel } from "./client";
import { runToolLoop, type Message, type ToolExecutor } from "./loop";
import { executeDevTool, getDevToolDefinitions, isDevToolName, summarizeDevToolResult, truncateResult } from "./dev-tools";
import { devElasticHost } from "@/lib/elastic/dev-client";
import type { AgentStep } from "@/lib/quest/schema";

/**
 * Dev-only "chat with the data" agent. One request = one assistant turn:
 * the model inspects the dev Elastic project through read-only tools,
 * constructs Query DSL / aggregations / ES|QL, and answers in prose. The
 * full tool trace (queries + results) is returned so the sidebar can show
 * exactly what was executed — that is the point: learning what queries the
 * real agent will need before real data arrives.
 */

export const DevChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
export type DevChatMessage = z.infer<typeof DevChatMessageSchema>;

export const DevChatRequestSchema = z.object({
  messages: z.array(DevChatMessageSchema).min(1).max(40),
});

export interface DevChatResponse {
  reply: string;
  trace: AgentStep[];
  model: string;
  ms: number;
}

const MAX_HISTORY = 12;

function systemPrompt(): string {
  return `You are the developer's data-exploration agent for "SF Side Quest", embedded in a dev sidebar. You are connected (read-only) to the Elasticsearch project at ${devElasticHost() ?? "the configured endpoint"}. It currently holds exemplary data; real SF 311 data will be loaded later. Your job is to answer questions about the data by constructing proper Elasticsearch queries and to help the developer learn which queries the production agent will need.

How to work:
- If you do not know what indices or fields exist, call list_indices and get_mapping before querying. Do not guess field names.
- Choose the right tool: 'search' for retrieving documents (full-text on text fields, term/range on keyword/number/date), 'aggregate' for counts/breakdowns/stats, 'esql' for analytical questions (STATS … BY) — it is usually the most concise. sample_documents shows real values.
- Keep result sizes small (≤ 10 docs unless asked) and request only needed _source fields.
- After getting results, answer concisely in plain prose or a compact markdown table. Then, when it is useful, show the key query you ran in a fenced code block (Query DSL as JSON or ES|QL) so the developer can reuse it.
- If a query fails, read the error, fix the query (field name, type, syntax) and retry. Explain what was wrong.
- HARD RULE: every number, name or value in your answer must appear in a tool result from this turn. If you do not have the data (query failed, not run yet), run the query — never fill in from memory or guess. If something cannot be computed, say so.
- Never attempt to write, update or delete anything. Never query system indices.
- When the developer asks about "the app" or "311 data", remember the production mapping (fields: id, requested_at, status, category, subtype, details, address, neighborhood, location:geo_point, description) and point out differences from the dev dataset when relevant.`;
}

const devExecutor: ToolExecutor = {
  isTool: isDevToolName,
  execute: async (name, args) => {
    if (!isDevToolName(name)) throw new Error(`Unknown tool: ${name}`);
    return truncateResult(await executeDevTool(name, args));
  },
  summarize: (name, result) => (isDevToolName(name) ? summarizeDevToolResult(name, result) : "ok"),
};

export async function runDevChat(history: DevChatMessage[]): Promise<DevChatResponse> {
  const started = Date.now();
  const model = getMistralModel();
  const trace: AgentStep[] = [];

  const messages: Message[] = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-MAX_HISTORY).map((m): Message => ({ role: m.role, content: m.content })),
  ];

  const reply = await runToolLoop({
    model,
    messages,
    tools: getDevToolDefinitions(),
    trace,
    executor: devExecutor,
    includeResults: true,
    forceFirstTool: false,
    maxRounds: 10,
    nudgeAfterError: 2,
    temperature: 0.2,
  });

  return { reply: reply || "(no reply)", trace, model, ms: Date.now() - started };
}
