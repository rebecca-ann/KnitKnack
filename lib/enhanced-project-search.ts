import "server-only";
import { type SearchFilters, loosen } from "./filters";
import {
  type ProjectSearchResponse,
  type ProjectSummary,
  getPatternCategories,
  getPatternCategoryChains,
  searchProjects,
} from "./ravelry-client";
import { rerankProjects } from "./reranker";

// Enhanced project search (opt-in, see CLAUDE.md):
//   Query A — the normal structured search.
//   Query B — loosen(filters): category swapped for category names as text, larger page.
//   Candidates = B minus projects already in A, minus projects whose linked pattern is already
//   in the requested category (those are correctly filed, just further down A's pages).
//   Claude judges the remaining candidates; matches come back as "recovered".

const QUERY_B_PAGE_SIZE = 100;

export interface RecoveredProject {
  project: ProjectSummary;
  reason: string;
}

export interface EnhancedProjectSearchResponse extends ProjectSearchResponse {
  enhanced: { recovered: RecoveredProject[]; candidatesReviewed: number } | { skipped: string };
}

export async function searchProjectsEnhanced(filters: SearchFilters): Promise<EnhancedProjectSearchResponse> {
  if (!filters.categories?.length) {
    return { ...(await searchProjects(filters)), enhanced: { skipped: "Pick a category to use enhanced search." } };
  }

  const allCategories = await getPatternCategories();
  const target = new Set(filters.categories);
  const categoryNames = allCategories.filter((c) => target.has(c.permalink)).map((c) => c.name);

  const [a, b] = await Promise.all([
    searchProjects(filters),
    searchProjects({ ...loosen(filters, categoryNames), pageSize: QUERY_B_PAGE_SIZE }),
  ]);

  const inA = new Set(a.projects.map((p) => p.id));
  const notInA = b.projects.filter((p) => !inA.has(p.id));
  const chains = await getPatternCategoryChains(
    notInA.map((p) => p.pattern_id).filter((id): id is number => typeof id === "number"),
  );
  const candidates = notInA.filter((p) => {
    const chain = p.pattern_id ? chains.get(p.pattern_id) : undefined;
    return !chain || ![...target].some((c) => chain.has(c));
  });

  let matches: Map<number, string>;
  try {
    matches = await rerankProjects({ categoryNames, keywords: filters.query }, candidates);
  } catch (err) {
    // Degrade to the plain results rather than failing the whole search.
    console.error("Enhanced re-rank failed", err);
    return { ...a, enhanced: { skipped: "Claude re-rank failed; showing standard results only." } };
  }
  const recovered = candidates
    .filter((p) => matches.has(p.id))
    .map((project) => ({ project, reason: matches.get(project.id)! }));

  return { ...a, enhanced: { recovered, candidatesReviewed: candidates.length } };
}
