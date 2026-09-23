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
// Bump when the prompt or schema changes so cached parses from the old version aren't reused.
const PROMPT_VERSION = 3;

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
- Keywords: keep words that describe the item itself — construction, stitch, style, audience (e.g. "raglan", "cabled", "top-down", "colorwork", "baby", "men's"). Drop filler, subjective or speed/effort words ("quick", "easy", "cozy", "nice"), yarn-amount phrases, and anything already captured by another field.

Examples:
- "something cozy" → no category, no keywords (vague: nothing to filter on)
- "cozy chunky blanket" → categories [blanket], weights [bulky], no keywords
- "tea cozy" → categories [cozy]
- "easy colorwork mittens for kids, at most 300 m" → categories [mittens], keywords "colorwork kids", yarn_amount at_most 300 meters

Categories (indentation shows the hierarchy; parents include their children):
${categoryLines}`;
}

export async function parseNaturalLanguage(text: string): Promise<SearchFilters> {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) throw new NlParseError("Search text is empty");

  return cached(`nl:v${PROMPT_VERSION}:${normalized}`, PARSE_TTL_MS, async () => {
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

    return {
      query: out.keywords?.trim() || undefined,
      weights: out.weights.length ? [...new Set(out.weights)] : undefined,
      categories: out.categories.length ? [...new Set(out.categories)] : undefined,
      yardage: toYardage(out.yarn_amount),
    };
  });
}
