import "server-only";
import { type SearchFilters, fromQueryString } from "./filters";
import { RavelryError, getPatternCategories } from "./ravelry-client";

export class BadRequestError extends Error {}

/**
 * Parses a /api/search/* request into SearchFilters. Unknown category permalinks are
 * rejected here, because Ravelry answers them with a 500.
 */
export async function parseSearchRequest(request: Request): Promise<SearchFilters> {
  const filters = fromQueryString(new URL(request.url).searchParams);
  if (filters.categories?.length) {
    const known = new Set((await getPatternCategories()).map((c) => c.permalink));
    const unknown = filters.categories.filter((c) => !known.has(c));
    if (unknown.length) throw new BadRequestError(`Unknown category: ${unknown.join(", ")}`);
  }
  return filters;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof RavelryError) {
    console.error(err);
    return Response.json({ error: `Ravelry request failed (${err.status})` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
