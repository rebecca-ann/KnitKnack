import { fromQueryString } from "@/lib/filters";
import {
  type PatternCategory,
  getPatternCategories,
  searchPatterns,
  searchProjects,
} from "@/lib/ravelry-client";
import SearchClient, { type SearchKind, type SearchResults } from "./search-client";

export default async function SearchPage(props: PageProps<"/search">) {
  const raw = await props.searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const v of Array.isArray(value) ? value : [value ?? ""]) params.append(key, v);
  }

  let categories: PatternCategory[] = [];
  try {
    categories = await getPatternCategories();
  } catch (err) {
    console.error("Failed to load pattern categories", err);
  }

  const kind: SearchKind = params.get("kind") === "projects" ? "projects" : "patterns";
  const filters = fromQueryString(params);
  const known = new Set(categories.map((c) => c.permalink));
  filters.categories = filters.categories?.filter((c) => known.has(c));

  // A shared/reloaded URL renders its results server-side; later searches go through the API routes.
  let initialResults: SearchResults | null = null;
  if (params.size > 0) {
    try {
      initialResults =
        kind === "patterns"
          ? { kind, ...(await searchPatterns(filters)) }
          : { kind, ...(await searchProjects(filters)) };
    } catch (err) {
      console.error("Initial search failed", err);
    }
  }

  return (
    <SearchClient
      categories={categories}
      initialKind={kind}
      initialFilters={filters}
      initialResults={initialResults}
    />
  );
}
