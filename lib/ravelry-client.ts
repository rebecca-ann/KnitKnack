import "server-only";
import { cached } from "./cache";
import { type SearchFilters, filtersKey, toRavelryParams } from "./filters";

// Thin typed wrapper over Ravelry's read-only search endpoints.
// Auth: a Ravelry "Basic Auth" (read-only) app's username/password, from .env.local.

const BASE_URL = "https://api.ravelry.com";

export interface RavelryPhoto {
  square_url?: string;
  small_url?: string;
  medium_url?: string;
}

export interface Paginator {
  page: number;
  page_count: number;
  page_size: number;
  results: number;
  last_page: number;
}

export interface PatternSummary {
  id: number;
  name: string;
  permalink: string;
  free: boolean;
  designer?: { id: number; name: string };
  first_photo?: RavelryPhoto | null;
}

export interface ProjectSummary {
  id: number;
  name: string;
  permalink: string;
  pattern_name?: string | null;
  pattern_id?: number | null;
  status_name?: string;
  user?: { username: string };
  first_photo?: RavelryPhoto | null;
  links?: { self?: { href: string } };
}

export interface PatternSearchResponse {
  patterns: PatternSummary[];
  paginator: Paginator;
}

export interface ProjectSearchResponse {
  projects: ProjectSummary[];
  paginator: Paginator;
}

export class RavelryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function authHeader(): string {
  const user = process.env.RAVELRY_USERNAME;
  const pass = process.env.RAVELRY_PASSWORD;
  if (!user || !pass) {
    throw new Error("RAVELRY_USERNAME / RAVELRY_PASSWORD are not set in .env.local");
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function get<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}?${params}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new RavelryError(res.status, `Ravelry ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const SEARCH_TTL_MS = 10 * 60 * 1000;
const CATEGORIES_TTL_MS = 24 * 60 * 60 * 1000;

export function searchPatterns(filters: SearchFilters): Promise<PatternSearchResponse> {
  return cached(`patterns:${filtersKey(filters)}`, SEARCH_TTL_MS, () =>
    get("/patterns/search.json", toRavelryParams(filters)),
  );
}

export function searchProjects(filters: SearchFilters): Promise<ProjectSearchResponse> {
  return cached(`projects:${filtersKey(filters)}`, SEARCH_TTL_MS, () =>
    get("/projects/search.json", toRavelryParams(filters)),
  );
}

interface RawCategory {
  name: string;
  permalink: string;
  children?: RawCategory[];
}

export interface PatternCategory {
  permalink: string;
  name: string;
  /** 0 = top level (e.g. "clothing"); children follow their parent in list order. */
  depth: number;
}

/** Ravelry's pattern category tree, flattened depth-first (root node omitted). */
export function getPatternCategories(): Promise<PatternCategory[]> {
  return cached("pattern-categories", CATEGORIES_TTL_MS, async () => {
    const { pattern_categories: root } = await get<{ pattern_categories: RawCategory }>(
      "/pattern_categories/list.json",
      new URLSearchParams(),
    );
    const out: PatternCategory[] = [];
    const walk = (c: RawCategory, depth: number) => {
      out.push({ permalink: c.permalink, name: c.name, depth });
      c.children?.forEach((child) => walk(child, depth + 1));
    };
    root.children?.forEach((c) => walk(c, 0));
    return out;
  });
}
