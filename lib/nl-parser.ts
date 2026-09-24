import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { cached } from "./cache";
import { claude } from "./claude";
import { type SearchFilters, YARN_WEIGHTS } from "./filters";
import { type PatternCategory, getPatternCategories } from "./ravelry-client";

// Natural language → SearchFilters. The model only translates; it never searches or ranks.

const MODEL = "claude-haiku-4-5";
const PARSE_TTL_MS = 60 * 60 * 1000;
// Bump when the prompt or schema changes so cached parses from the old version aren't reused.
const PROMPT_VERSION = 5;

export class NlParseError extends Error {}

function buildSchema(categories: PatternCategory[]) {
  const permalinks = categories.map((c) => c.permalink) as [string, ...string[]];
  return z.object({
    keywords: z
      .string()
      .nullable()
      .describe("All remaining meaningful words not captured by other fields; all must match. Null if none."),
    any_keywords: z
      .array(z.string())
      .describe("Explicit alternatives the user offered ('cabled or lace'); at least one must match. Empty if none."),
    weights: z.array(z.enum(YARN_WEIGHTS)).describe("Yarn weights mentioned or clearly implied. Empty if none."),
    categories: z.array(z.enum(permalinks)).describe("Matching category permalinks. Empty if none."),
    // The model reports the amount as stated; unit conversion and "around" widening happen in code.
    yarn_amount: z
      .object({
        bound: z.enum(["at_most", "at_least", "around", "between"]),
        amount: z.number().describe("Total length. For 'between', the lower end."),
        amount_upper: z.number().nullable().describe("Upper end for 'between'; otherwise null."),
        unit: z.enum(["yards", "meters"]),
      })
      .nullable()
      .describe("Total yarn length mentioned. Null if none."),
  });
}

const YARDS_PER_METER = 1.0936;
const AROUND_TOLERANCE = 0.15;

type YarnAmount = z.infer<ReturnType<typeof buildSchema>>["yarn_amount"];

function toYardage(a: YarnAmount): SearchFilters["yardage"] {
  if (!a) return undefined;
  const toYards = (n: number) => Math.round(a.unit === "meters" ? n * YARDS_PER_METER : n);
  const amount = toYards(a.amount);
  switch (a.bound) {
    case "at_most":
      return { max: amount };
    case "at_least":
      return { min: amount };
    case "around":
      return {
        min: Math.round(amount * (1 - AROUND_TOLERANCE)),
        max: Math.round(amount * (1 + AROUND_TOLERANCE)),
      };
    case "between": {
      const upper = a.amount_upper === null ? amount : toYards(a.amount_upper);
      return { min: Math.min(amount, upper), max: Math.max(amount, upper) };
    }
  }
}

/**
 * The model sometimes repeats a category or weight word in keywords ("hat" alongside
 * category hat). Keywords are ANDed in Ravelry's text search, so that would silently drop
 * matches — remove those words here rather than trusting the prompt.
 */
function stripCapturedWords(
  keywords: string | null,
  chosenCategories: string[],
  allCategories: PatternCategory[],
  weights: string[],
): string | undefined {
  if (!keywords) return undefined;
  const chosen = new Set(chosenCategories);
  const captured = new Set(
    allCategories
      .filter((c) => chosen.has(c.permalink))
      .flatMap((c) => [c.name, c.permalink])
      .concat(weights)
      .flatMap((s) => s.toLowerCase().split(/[^a-z]+/))
      .filter((w) => w.length > 1),
  );
  const singular = (w: string) => w.replace(/s$/, "");
  const kept = keywords
    .split(/\s+/)
    .filter((w) => {
      const bare = w.toLowerCase().replace(/[^a-z]/g, "");
      return bare && !captured.has(bare) && !captured.has(singular(bare));
    });
  return kept.join(" ") || undefined;
}

function buildSystemPrompt(categories: PatternCategory[]): string {
  const categoryLines = categories
    .map((c) => `${"  ".repeat(c.depth)}${c.permalink}: ${c.name}`)
    .join("\n");
  return `You convert a knitter's free-text search for Ravelry patterns or projects into structured search filters.

Rules:
- Only set a filter when the text states or clearly implies it. Leave everything else empty/null — an over-constrained search returns nothing.
- Yarn weights: map common synonyms (e.g. "8 ply" → dk, "10 ply" → worsted, "4 ply" → fingering, "chunky" → bulky, "sock yarn" → fingering). A range like "sport to worsted" means each weight in between.
- Categories: only for the kind of item being made. Match the level of detail the text gives: "sweater with buttons" → cardigan, but "sweater" → sweater and "socks" → socks (not a sock subtype). Adjectives are never categories ("cozy" describes a feeling; the cozy category is for tea/egg cozies). Only use permalinks from the list below.
- Yarn amount: report it as stated, in its original unit; don't convert. "Under 500 yards" → at_most 500; "at least 1000 m" → at_least 1000 meters; "around 800" → around 800. Yarn the knitter already has ("2 skeins of 400 yd", "one 450 m ball") is an upper limit: at_most the total (multiply skeins by length per skein). A skein count with no length ("one skein") is unknown — set null.
- Keywords: first pull out every piece that fits a structured field above. Everything else that carries meaning goes into keywords, in the user's own words — construction, stitch, style, audience, and descriptive or subjective words too (e.g. "raglan", "cabled", "baby", "men's", "cozy", "quick", "easy", "one skein"). Remove only: filler ("a", "an", "the", "for", "with", "some", "something", "I'm looking for", "I want"), generic words ("pattern", "project", "knit", "knitting", "yarn"), and the exact words already turned into a weight, category, or yarn amount.
- Alternatives: when the user offers explicit alternatives ("cabled or lace", "either stripes or colorwork"), put those alternatives in any_keywords instead of keywords. Alternatives between categories or weights ("hat or cowl", "dk or worsted") go in those fields, not any_keywords.

Examples:
- "something cozy" → keywords "cozy"
- "cozy chunky blanket" → categories [blanket], weights [bulky], keywords "cozy"
- "tea cozy" → categories [cozy]
- "easy colorwork mittens for kids, at most 300 m" → categories [mittens], keywords "easy colorwork kids", yarn_amount at_most 300 meters
- "a cabled or lace hat in dk" → categories [hat], weights [dk], any_keywords ["cabled", "lace"]

Categories (indentation shows the hierarchy; parents include their children):
${categoryLines}`;
}

export async function parseNaturalLanguage(text: string): Promise<SearchFilters> {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) throw new NlParseError("Search text is empty");

  return cached(`nl:v${PROMPT_VERSION}:${normalized}`, PARSE_TTL_MS, async () => {
    const categories = await getPatternCategories();
    const response = await claude().messages.parse({
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

    return {
      query: stripCapturedWords(out.keywords, out.categories, categories, out.weights),
      anyKeywords: out.any_keywords.length ? [...new Set(out.any_keywords.map((k) => k.trim()).filter(Boolean))] : undefined,
      weights: out.weights.length ? [...new Set(out.weights)] : undefined,
      categories: out.categories.length ? [...new Set(out.categories)] : undefined,
      yardage: toYardage(out.yarn_amount),
    };
  });
}
