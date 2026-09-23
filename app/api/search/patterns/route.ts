import { type SearchFilters } from "@/lib/filters";
import { RavelryError, searchPatterns } from "@/lib/ravelry-client";

// Day 1: hardcoded filters to confirm the raw Ravelry pattern search works.
// Day 2 replaces this with filters parsed from the request.
const SMOKE_TEST_FILTERS: SearchFilters = {
  weights: ["worsted"],
  categories: ["pullover"],
  yardage: { min: 800, max: 1500 },
  pageSize: 5,
};

export async function GET() {
  try {
    const result = await searchPatterns(SMOKE_TEST_FILTERS);
    return Response.json(result);
  } catch (err) {
    const status = err instanceof RavelryError ? 502 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
