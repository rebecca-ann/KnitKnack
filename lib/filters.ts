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
const YARDAGE_UPPER_BOUND = 100_000;

/**
 * Converts SearchFilters to Ravelry search query params. Ravelry's API search params
 * mirror the website's search URL params (weight, pc, yardage, ...), with multiple
 * values joined by "|". Unknown weight/pc values make Ravelry return a 500.
 */
export function toRavelryParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query?.trim()) params.set("query", filters.query.trim());
  if (filters.weights?.length) params.set("weight", filters.weights.join("|"));
  if (filters.categories?.length) params.set("pc", filters.categories.join("|"));

  // Ravelry's yardage param is "min|max" and matches patterns whose yardage range
  // (smallest to largest size) overlaps it. An open upper bound ("800|") returns
  // patterns with no yardage, so both ends are always sent.
  const { min, max } = filters.yardage ?? {};
  if (min !== undefined || max !== undefined) {
    params.set("yardage", `${min ?? 0}|${max ?? YARDAGE_UPPER_BOUND}`);
  }

  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? DEFAULT_PAGE_SIZE));
  return params;
}

// --- App URL format (used by the UI and our /api/search/* routes, not by Ravelry) ---
// ?q=raglan&weight=dk&weight=worsted&category=pullover&yardMin=800&yardMax=1500&page=2

export function toQueryString(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.query?.trim()) params.set("q", filters.query.trim());
  filters.weights?.forEach((w) => params.append("weight", w));
  filters.categories?.forEach((c) => params.append("category", c));
  if (filters.yardage?.min !== undefined) params.set("yardMin", String(filters.yardage.min));
  if (filters.yardage?.max !== undefined) params.set("yardMax", String(filters.yardage.max));
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

function parseNonNegativeInt(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Parses the app URL format into SearchFilters. Unknown weights are dropped; category
 * permalinks are not validated here (the list comes from Ravelry at runtime).
 */
export function fromQueryString(params: URLSearchParams): SearchFilters {
  const weights = params
    .getAll("weight")
    .filter((w): w is YarnWeight => (YARN_WEIGHTS as readonly string[]).includes(w));
  const categories = params.getAll("category").filter(Boolean);
  const min = parseNonNegativeInt(params.get("yardMin"));
  const max = parseNonNegativeInt(params.get("yardMax"));
  const page = parseNonNegativeInt(params.get("page"));

  return {
    query: params.get("q")?.trim() || undefined,
    weights: weights.length ? weights : undefined,
    categories: categories.length ? categories : undefined,
    yardage: min !== undefined || max !== undefined ? { min, max } : undefined,
    page: page && page > 0 ? page : undefined,
  };
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
 * Replaces the category filter — the field users most often mis-tag on projects — with the
 * category names as free text, keeping everything else. Used by the enhanced project search's
 * loosened "Query B". Pass the display names of `filters.categories` (e.g. "Coat / Jacket").
 *
 * Ravelry's text query ANDs words but `|` ORs adjacent terms and binds tighter, so
 * "raglan coat|jacket" means raglan AND (coat OR jacket).
 */
export function loosen(filters: SearchFilters, categoryNames: string[]): SearchFilters {
  const terms = [
    ...new Set(
      categoryNames
        .flatMap((n) => n.split("/"))
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const query = [filters.query, terms.join("|")].filter(Boolean).join(" ");
  return { ...filters, categories: undefined, query: query || undefined };
}
