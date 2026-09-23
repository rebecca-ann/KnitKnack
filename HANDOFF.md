# Handoff: Ravelry AI Search Prototype

## What this is
A prototype (not full MVP) for an AI-enhanced wrapper around Ravelry.com, focused on
searching/filtering patterns and projects by yarn weight, yarn quantity, and category.
Single user, read-only, local-only. Goal: prove the core search + NL-parsing concept
works before investing in accounts, persistence, or public deployment.

## Why it's scoped this way (context for future decisions)
- Ravelry's *pattern* data (weight, category, yardage) is designer-entered and reliable —
  AI's job there is just translating natural language into structured filters, not fixing data.
- Ravelry's *project* data is often mis-tagged or under-tagged by users (category especially,
  and "unisex" is used as a catch-all that obscures actually-masculine-styled designs). AI's
  job there is recovery/re-ranking, not just translation — but this is a more expensive,
  optional path.
- Full MVP (multi-user, deployed, accounts, background enrichment) was scoped separately;
  this prototype exists to validate the search+NL core before building that out.

## Stack
- Next.js (React + TypeScript, App Router) — frontend and API routes (BFF), no separate backend
- Claude API — NL query parsing (query → structured filters); re-ranking is a stretch goal
- In-memory cache (plain Map) — no Redis for prototype scale
- No database, no auth, no deployment — runs locally via `npm run dev`
- Ravelry API — developer (non-commercial) key is sufficient for single-user local use;
  commercial/public access request is deferred until this becomes the real MVP

## Project structure
```
/app
  /api/search/patterns/route.ts   → NL parse → SearchFilters → Ravelry pattern search
  /api/search/projects/route.ts   → same, plus optional enhanced-mode toggle (stretch)
  /search                         → single page: filter form + NL input + results
/lib
  ravelry-client.ts                → thin typed wrapper over Ravelry's read-only search endpoints
  filters.ts                       → SearchFilters type, Ravelry query builder, loosen() helper
  nl-parser.ts                     → Claude call: free text → SearchFilters (JSON mode)
  reranker.ts                      → stretch only: Claude call to recover miscategorized projects
  cache.ts                         → in-memory Map keyed on normalized filter set
```
No `/db`, no `/auth` — intentionally excluded at this scope.

## Core data contract
`SearchFilters` (weight, yardage/quantity range, category) is the single object every
path consumes — the query builder converts it to Ravelry params in both the manual UI path
and the AI-parsed path. Keep this contract stable; it's what makes the (future) enhanced
project-search toggle a thin wrapper rather than a forked codebase.

## Enhanced project search (stretch goal, day 4)
Toggle in UI: off → single Ravelry query (Query A) with structured filters, same as patterns.
On → adds a second, loosened/unfiltered query (Query B) in parallel, then a Claude re-rank
pass cross-checks Query B's title/notes text against the filters and merges in recovered
items flagged as "loosely matched." This is gated behind a toggle because it doubles
Ravelry calls and adds an LLM call per search — not something to default on.

Explicitly NOT in scope for this pass: vision-based "style_lean" scoring for masculine/
feminine styling classification. That requires a background enrichment job (classify once,
cache in a DB) and depends on persistence that this prototype doesn't have. Revisit once
Postgres exists.

## Build order / schedule (3–4 days, 2–4 hrs/day)
| Day | Task |
|---|---|
| 1 | Ravelry dev app + OAuth, raw client, `SearchFilters` + query builder, confirm pattern search via hardcoded filter object |
| 2 | Basic filter UI (form → API route → results) for patterns and projects; in-memory cache wrapper |
| 3 | NL parser: Claude call → `SearchFilters`, wired into pattern search; NL input box in UI |
| 4 | Stretch: enhanced project toggle (Query B + re-rank); otherwise polish/bugfix |

## Immediate first steps for Claude Code
1. Scaffold Next.js + TypeScript app
2. Register a Ravelry developer app, store OAuth creds in `.env.local`
3. Build `ravelry-client.ts` and confirm a raw pattern search works before anything else
