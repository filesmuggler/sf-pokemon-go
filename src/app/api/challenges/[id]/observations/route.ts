import { NextResponse, type NextRequest } from "next/server";
import { ObservationInputSchema } from "@/lib/challenge/schema";
import { ChallengeError, submitObservation } from "@/lib/challenge/service";

/**
 * POST /api/challenges/:id/observations
 * Body: { answer: { yes_no | count | choice }, location: { lat, lon }, note?, photo_url?, player? }
 * The player must be near the challenge spot. Returns { observation, challenge, closed_loop }.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/challenges/[id]/observations">) {
  const { id } = await ctx.params;
  const parsed = ObservationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(await submitObservation(id, parsed.data));
  } catch (err) {
    if (err instanceof ChallengeError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/challenges/:id/observations]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
