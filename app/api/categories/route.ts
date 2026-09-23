import { getPatternCategories } from "@/lib/ravelry-client";
import { errorResponse } from "@/lib/search-request";

export async function GET() {
  try {
    return Response.json(await getPatternCategories());
  } catch (err) {
    return errorResponse(err);
  }
}
