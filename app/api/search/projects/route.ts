import { searchProjects } from "@/lib/ravelry-client";
import { errorResponse, parseSearchRequest } from "@/lib/search-request";

// Enhanced mode (loosened Query B + Claude re-rank) will hang off this route — Day 4 stretch.
export async function GET(request: Request) {
  try {
    const filters = await parseSearchRequest(request);
    return Response.json(await searchProjects(filters));
  } catch (err) {
    return errorResponse(err);
  }
}
