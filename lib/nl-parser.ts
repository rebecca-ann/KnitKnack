import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { cached } from "./cache";
import { type SearchFilters, YARN_WEIGHTS } from "./filters";
import { type PatternCategory, getPatternCategories } from "./ravelry-client";

// Natural language → SearchFilters. The model only translates; it never searches or ranks.

const MODEL = "claude-haiku-4-5";
const PARSE_TTL_MS = 60 * 60 * 1000;

let client: Anthropic | undefined;

export class NlParseError extends Error {}

function buildSchema(categories: PatternCategory[]) {
  const permalinks = categories.map((c) => c.permalink) as [string, ...string[]];
  return z.object({
    keywords: z
      .string()
      .nullable()
      .describe("Leftover descriptive words not captured by other fields, e.g. 'raglan cabled'. Null if none."),
    weights: z.array(z.enum(YARN_WEIGHTS)).describe("Yarn weights mentioned or clearly implied. Empty if none."),
    categories: z.array(z.enum(permalinks)).describe("Most specific matching category permalinks. Empty if none."),
    yardage_min: z.number().int().nullable().describe("Minimum total yardage, in yards. Null if unspecified."),
    yardage_max: z.number().int().nullable().describe("Maximum total yardage, in yards. Null if unspecified."),
  });
}

function buildSystemPrompt(categories: PatternCategory[]): string {
  const categoryLines = categories
    .map((c) => `${"  ".repeat(c.depth)}${c.permalink}: ${c.name}`)
    .join("\n");
  return `You convert a knitter's free-text search for Ravelry patterns or projects into structured search filters.

Rules:
- Only set a filter when the text states or clearly implies it. Leave everything else empty/null — an over-constrained search returns nothing.
- Yarn weights: map common synonyms (e.g. "8 ply" → dk, "10 ply" → worsted, "4 ply" → fingering, "chunky" → bulky, "sock yarn" → fingering). A range like "sport to worsted" means each weight in between.
- Categories: pick the most specific category that fits ("sweater with buttons" → cardigan; "sweater" alone → sweater). Only use permalinks from the list below.
- Yardage is the total yarn amount, in yards. Convert meters (1 m = 1.094 yd). If the text gives skeins/balls with a per-skein length, multiply. "Under 500 yards" → max 500; "at least 1000" → min 1000; "around 800" → roughly ±15%. Descriptions like "quick" or "stash-buster" are not yardage — ignore them for yardage.
- Put remaining meaningful descriptors (construction, stitch, style, e.g. "raglan", "cabled", "top-down", "colorwork") in keywords. Drop filler words and anything already captured by another field.

Categories (indentation shows the hierarchy; parents include their children):
${categoryLines}`;
}

export async function parseNaturalLanguage(text: string): Promise<SearchFilters> {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) throw new NlParseError("Search text is empty");

  return cached(`nl:${normalized}`, PARSE_TTL_MS, async () => {
    const categories = await getPatternCategories();
    client ??= new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(categories),
      messages: [{ role: "user", content: text.trim() }],
      output_config: { format: zodOutputFormat(buildSchema(categories)) },
    });

    const out = response.parsed_output;
    if (response.stop_reason === "refusal" || !out) {
      throw new NlParseError(`Could not interpret the search (stop reason: ${response.stop_reason})`);
    }

    // Guard against a flipped range rather than sending Ravelry an empty one.
    let [min, max] = [out.yardage_min ?? undefined, out.yardage_max ?? undefined];
    if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];

    return {
      query: out.keywords?.trim() || undefined,
      weights: out.weights.length ? [...new Set(out.weights)] : undefined,
      categories: out.categories.length ? [...new Set(out.categories)] : undefined,
      yardage: min !== undefined || max !== undefined ? { min, max } : undefined,
    };
  });
}
