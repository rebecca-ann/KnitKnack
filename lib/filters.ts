// SearchFilters is the single contract every search path (manual form, NL parser,
// enhanced project search) produces and consumes. Keep it stable.

export const YARN_WEIGHTS = [
  "thread",
  "cobweb",
  "lace",
  "light-fingering",
  "fingering",
  "sport",
  "dk",
  "worsted",
  "aran",
  "bulky",
  "super-bulky",
  "jumbo",
] as const;

export type YarnWeight = (typeof YARN_WEIGHTS)[number];

export interface YardageRange {
  min?: number;
  max?: number;
}

export interface SearchFilters {
  /** Free-text keywords passed through to Ravelry's `query` param. */
  query?: string;
  /** Ravelry yarn weight permalinks; multiple values are OR'd. */
  weights?: YarnWeight[];
  /** Total yardage required. */
  yardage?: YardageRange;
  /** Ravelry pattern category permalinks (e.g. "pullover", "hat"); multiple values are OR'd. */
  categories?: string[];
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 24;

/**
 * Converts SearchFilters to Ravelry search query params. Ravelry's API search params
 * mirror the website's search URL params (weight, pc, yardage, ...), with multiple
 * values joined by "|".
 */
export function toRavelryParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query?.trim()) params.set("query", filters.query.trim());
  if (filters.weights?.length) params.set("weight", filters.weights.join("|"));
  if (filters.categories?.length) params.set("pc", filters.categories.join("|"));

  const { min, max } = filters.yardage ?? {};
  if (min !== undefined || max !== undefined) {
    params.set("yardage", `${min ?? ""}-${max ?? ""}`);
  }

  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? DEFAULT_PAGE_SIZE));
  return params;
}

/** Stable cache key: same filters (regardless of property/array order) → same key. */
export function filtersKey(filters: SearchFilters): string {
  const params = toRavelryParams({
    ...filters,
    weights: filters.weights ? [...filters.weights].sort() : undefined,
    categories: filters.categories ? [...filters.categories].sort() : undefined,
  });
  params.sort();
  return params.toString();
}

/**
 * Drops the structured filters that users most often mis-tag on projects (category),
 * keeping keywords. Used by the enhanced project search's loosened "Query B" (stretch).
 */
export function loosen(filters: SearchFilters): SearchFilters {
  return { ...filters, categories: undefined };
}
