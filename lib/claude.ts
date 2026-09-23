import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Shared Anthropic client, created on first use so a missing key only fails the AI routes. */
export function claude(): Anthropic {
  return (client ??= new Anthropic());
}
