import { searchProjectsEnhanced } from "@/lib/enhanced-project-search";
import { searchProjects } from "@/lib/ravelry-client";
import { errorResponse, parseSearchRequest } from "@/lib/search-request";

// ?enhanced=1 opts into the loosened Query B + Claude re-rank. Never on by default:
// it adds two Ravelry calls and a Claude call per search.
export async function GET(request: Request) {
  try {
    const filters = await parseSearchRequest(request);
    const enhanced = new URL(request.url).searchParams.get("enhanced") === "1";
    return Response.json(enhanced ? await searchProjectsEnhanced(filters) : await searchProjects(filters));
  } catch (err) {
    return errorResponse(err);
  }
}
