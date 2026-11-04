import { NextResponse, type NextRequest } from "next/server";
import { getChallengeWithObservations } from "@/lib/challenge/service";

/** GET /api/challenges/:id → { challenge, observations } */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/challenges/[id]">) {
  const { id } = await ctx.params;
  const result = await getChallengeWithObservations(id);
  if (!result) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  return NextResponse.json(result);
}
