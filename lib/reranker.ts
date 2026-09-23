import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { cached } from "./cache";
import { claude } from "./claude";
import type { ProjectSummary } from "./ravelry-client";

// Enhanced project search: judges projects that sit outside the requested category on Ravelry
// (miscategorized or uncategorized) and keeps the ones that really are that kind of item.
// Text-only (name, pattern name, tags) — photo/style judging is out of scope (see CLAUDE.md).

const MODEL = "claude-sonnet-5";
const RERANK_TTL_MS = 60 * 60 * 1000;
const PROMPT_VERSION = 4;

export interface RerankTarget {
  /** Display names of the requested categories, e.g. ["Cardigan"]. */
  categoryNames: string[];
  keywords?: string;
}

const Schema = z.object({
  matches: z.array(
    z.object({
      id: z.number().int(),
      reason: z.string().describe("Short reason, under 12 words, citing the evidence."),
    }),
  ),
});

function describeCandidate(p: ProjectSummary): string {
  const tags = p.tag_names?.length ? p.tag_names.join(", ") : "none";
  return `- id ${p.id} | project name: ${p.name} | pattern: ${p.pattern_name ?? "none (personal design)"} | tags: ${tags}`;
}

/** Returns the candidates judged to match, keyed by project id, with a short reason each. */
export async function rerankProjects(
  target: RerankTarget,
  candidates: ProjectSummary[],
): Promise<Map<number, string>> {
  if (!candidates.length) return new Map();

  const ids = candidates.map((c) => c.id).sort((a, b) => a - b);
  const key = `rerank:v${PROMPT_VERSION}:${target.categoryNames.join("|")}:${target.keywords ?? ""}:${ids.join(",")}`;

  const matches = await cached(key, RERANK_TTL_MS, async () => {
    const wanted = target.categoryNames.join(" or ");
    const response = await claude().messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system: `You review knitting/crochet projects from Ravelry. The user searched for: ${wanted}${
        target.keywords ? ` (keywords: ${target.keywords})` : ""
      }.

The projects below are NOT filed under that category on Ravelry — they may be miscategorized, uncategorized personal designs, or genuinely something else. Return only the projects whose name, pattern name, or tags give clear evidence that the finished item IS a ${wanted}. Judge what the item actually is:
- Go by the item noun, not any word that happens to match: a "wrap top" is a top, not a wrap; "Scarf & Hat" includes a hat.
- The pattern name outranks tags: a pattern named "... Cowl" is a cowl even if tagged "shawl". Tags alone are enough only for personal designs (no pattern) or when the names don't say what the item is.
- A passing mention is not enough (e.g. "worn over my cardigan", or a pullover tagged "cardigan-weight").
- Items made for dolls, toys, or pets don't count.
When unsure, leave it out.`,
      messages: [{ role: "user", content: candidates.map(describeCandidate).join("\n") }],
      output_config: { format: zodOutputFormat(Schema) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`Re-rank failed (stop reason: ${response.stop_reason})`);
    }
    return response.parsed_output.matches;
  });

  // Keep only ids we actually sent; the model can't add projects.
  const allowed = new Set(ids);
  return new Map(matches.filter((m) => allowed.has(m.id)).map((m) => [m.id, m.reason]));
}
