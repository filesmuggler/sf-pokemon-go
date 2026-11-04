import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { runQuestAgent } from "@/lib/mistral/agent";
import { FIXTURE_QUEST } from "@/lib/quest/fixture";
import { QuestRequestSchema } from "@/lib/quest/schema";

export const maxDuration = 120;

/**
 * POST /api/quest
 * Body: { lat, lon, radius_m?, days?, neighborhood_hint? }
 * Runs the Mistral agent over Elasticsearch-indexed 311 data and returns a Quest.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = QuestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  if (getEnv().QUEST_MOCK) {
    return NextResponse.json({
      ...FIXTURE_QUEST,
      quest: { ...FIXTURE_QUEST.quest, center: { lat: parsed.data.lat, lon: parsed.data.lon }, radius_m: parsed.data.radius_m },
    });
  }

  try {
    const result = await runQuestAgent(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/quest]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
