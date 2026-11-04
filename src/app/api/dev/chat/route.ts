import { NextResponse, type NextRequest } from "next/server";
import { getEnv, isDevAgentEnabled } from "@/lib/env";
import { devElasticHost, getDevElasticClient, hasDevElastic } from "@/lib/elastic/dev-client";
import { DevChatRequestSchema, runDevChat } from "@/lib/mistral/dev-agent";

export const maxDuration = 120;

function disabled() {
  return NextResponse.json({ error: "Dev agent is disabled" }, { status: 404 });
}

/**
 * GET /api/dev/chat — status for the sidebar: connection, indices, model.
 */
export async function GET() {
  if (!isDevAgentEnabled()) return disabled();
  const env = getEnv();
  const status: {
    enabled: true;
    host: string | null;
    mistral: boolean;
    model: string;
    connected: boolean;
    indices: { index: string; docs: number }[];
    error?: string;
  } = { enabled: true, host: devElasticHost(), mistral: Boolean(env.MISTRAL_API_KEY), model: env.MISTRAL_MODEL, connected: false, indices: [] };

  if (!hasDevElastic()) {
    status.error = "ELASTIC_DEV_ENDPOINT / ELASTIC_DEV_API_KEY not set";
    return NextResponse.json(status);
  }
  try {
    const rows = await getDevElasticClient().cat.indices({ format: "json", h: "index,docs.count" });
    status.connected = true;
    status.indices = rows
      .filter((r) => r.index && !r.index.startsWith("."))
      .map((r) => ({ index: r.index as string, docs: Number(r["docs.count"] ?? 0) }))
      .sort((a, b) => a.index.localeCompare(b.index));
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(status);
}

/**
 * POST /api/dev/chat — one assistant turn over the dev Elastic project.
 * Body: { messages: [{ role: "user" | "assistant", content }] }
 */
export async function POST(request: NextRequest) {
  if (!isDevAgentEnabled()) return disabled();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = DevChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.messages.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Last message must be from the user" }, { status: 400 });
  }

  try {
    const result = await runDevChat(parsed.data.messages);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/dev/chat]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
