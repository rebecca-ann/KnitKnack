import Anthropic from "@anthropic-ai/sdk";
import { NlParseError, parseNaturalLanguage } from "@/lib/nl-parser";
import { errorResponse } from "@/lib/search-request";

const MAX_TEXT_LENGTH = 500;

// POST { text } → { filters: SearchFilters }. The UI feeds the result into the normal search path.
export async function POST(request: Request) {
  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON: { text }" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: `text must be at most ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
  }

  try {
    return Response.json({ filters: await parseNaturalLanguage(text) });
  } catch (err) {
    if (err instanceof NlParseError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof Anthropic.AuthenticationError) {
      console.error(err);
      return Response.json({ error: "Claude API key is missing or invalid" }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Claude API rate limit hit — try again shortly" }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return Response.json({ error: `Claude API request failed (${err.status})` }, { status: 502 });
    }
    return errorResponse(err);
  }
}
