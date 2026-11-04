import { NextResponse, type NextRequest } from "next/server";
import { ChallengeRequestSchema } from "@/lib/challenge/schema";
import { ChallengeError, createChallengeBatch, listNearbyChallenges } from "@/lib/challenge/service";

export const maxDuration = 120;

/**
 * POST /api/challenges
 * Body: { lat, lon, radius_m?, days?, neighborhood_hint?, mode?: "rules" | "agent" }
 * Creates a batch of challenges near a point. "rules" (default) is instant; "agent" uses Mistral.
 */
export async function POST(request: NextRequest) {
  const parsed = ChallengeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(await createChallengeBatch(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/challenges?lat=&lon=&radius_m=&status=open|completed|expired */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }
  const status = p.get("status") as "open" | "completed" | "expired" | null;
  try {
    const challenges = await listNearbyChallenges({
      lat,
      lon,
      radiusM: Number(p.get("radius_m") ?? 1200),
      status: status ?? undefined,
    });
    return NextResponse.json({ challenges });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof ChallengeError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[api/challenges]", err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
}
