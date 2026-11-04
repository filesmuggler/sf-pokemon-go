import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { aggregateNearbyCategories, clusterDuplicates, searchNearbyCases } from "@/lib/elastic/queries";

const QuerySchema = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  radius_m: z.coerce.number().min(50).max(3000).default(1200),
  days: z.coerce.number().int().min(1).max(365).optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["open", "closed"]).optional(),
  size: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * GET /api/issues?lat=&lon=&radius_m=&q=&category=&status=
 * Direct Elasticsearch lookup — useful for a map view and for debugging the index.
 */
export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;

  try {
    const [search, categories] = await Promise.all([
      searchNearbyCases({
        lat: q.lat,
        lon: q.lon,
        radiusM: q.radius_m,
        days: q.days,
        query: q.q,
        category: q.category,
        status: q.status,
        size: q.size,
      }),
      aggregateNearbyCategories({ lat: q.lat, lon: q.lon, radiusM: q.radius_m, days: q.days }),
    ]);

    return NextResponse.json({
      total: search.total,
      cases: search.cases,
      clusters: clusterDuplicates(search.cases),
      categories: categories.categories,
    });
  } catch (err) {
    console.error("[api/issues]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
