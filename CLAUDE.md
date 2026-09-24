# CLAUDE.md

## Project
AI-enhanced Ravelry search prototype. Single user, read-only, local-only. See HANDOFF.md
for full background and rationale — this file is working memory for ongoing development.

## User background / working style
- Most experienced in C#; open to TS/Node for this project specifically since it's
  simpler for a Next.js full-stack app than splitting a C# backend.
- Prefers concise responses, no unnecessary praise/compliments.
- Prefers clarifying questions over assumptions when something is ambiguous; prefers
  being offered 2–3 concrete options rather than open-ended questions.

## Stack (do not deviate without discussion)
- Next.js, App Router, TypeScript, React
- Claude API for NL parsing (and re-ranking, if stretch goal is reached)
- In-memory cache only (no Redis) — this is a prototype-scale decision, revisit if
  scope grows
- No database, no auth — intentional for this phase
- Ravelry API, developer (non-commercial) key

## Non-negotiable architecture decisions
- `SearchFilters` (weight, yardage/quantity, category) is the single contract all search
  paths consume. Don't create parallel/divergent filter representations for NL vs manual
  search — both must produce the same `SearchFilters` object.
- Pattern search and project search are different problems:
  - Patterns: structured fields (weight/category/yardage) are reliable. AI only does
    NL → filters translation. No re-ranking needed for patterns.
  - Projects: structured fields are unreliable (miscategorization, lazy "unisex" tagging).
    Enhanced mode (stretch) adds a second loosened query + Claude re-rank, gated behind
    an explicit user toggle — never on by default, since it doubles API calls and adds
    LLM cost per search.
- Vision-based style/masculine-feminine scoring is explicitly deferred — it requires
  background enrichment + persistent storage (Postgres), which this prototype does not
  have. Do not attempt to build this against the in-memory/no-DB setup.

## Explicitly out of scope right now
- Accounts, auth, saved searches
- Redis / production caching
- Deployment / hosting
- Ravelry commercial API access (fine on dev key for single-user local use)
- Background enrichment jobs, vision classification, style_lean scoring
- Recommendations (was floated early on, deferred to a real future MVP phase)

## Current status
Day 1 complete (2026-09-23):
- Next.js 16 (App Router, TS, no Tailwind) scaffolded; `lib/filters.ts` (SearchFilters,
  `toRavelryParams`, `filtersKey`, `loosen`); `lib/ravelry-client.ts` (patterns + projects search);
  `GET /api/search/patterns` runs a hardcoded smoke-test filter and returns live results.

Day 2 complete (2026-09-23):
- `lib/cache.ts`: `cached(key, ttl, load)` — globalThis Map (survives HMR), shares in-flight loads,
  doesn't cache failures. Searches cached 10 min, category list 24 h.
- `GET /api/search/{patterns,projects}` take the app URL format (`lib/filters.ts` `toQueryString` /
  `fromQueryString`: `q`, `weight`*, `category`*, `yardMin`, `yardMax`, `page`); `GET /api/categories`.
  `lib/search-request.ts` validates categories against Ravelry's list (400 on unknown).
- `/search` page: tabs (patterns/projects), keywords, category select (from Ravelry's tree), yardage
  min/max, weight chips, results grid, prev/next paging. URL-synced; a loaded URL renders server-side.
  UI picks one category, though `SearchFilters.categories` supports several.

Day 3 complete (2026-09-23):
- `lib/nl-parser.ts`: Claude Haiku 4.5 (`claude-haiku-4-5`, user's choice for cost/latency) +
  structured outputs (`messages.parse` + Zod). Categories constrained by a schema enum of Ravelry
  permalinks. The model reports yarn amount as stated (bound/amount/unit); meters→yards and the ±15%
  "around" range are computed in code, because the model's arithmetic was unreliable. Cached 1 h;
  bump `PROMPT_VERSION` when changing prompt/schema. ~1–2 s per uncached parse.
- `POST /api/parse` `{ text }` → `{ filters }`. The UI's NL box fills the manual form from the result,
  then searches through the normal path, so NL and manual search share one `SearchFilters` path.
- Known limit: the form holds one category, so multi-category parses ("hat or cowl") keep only the
  first.

Keyword changes (2026-09-23, after Day 4):
- `SearchFilters.anyKeywords` (match-any): sent as an OR group in Ravelry's text query
  (`raglan cabled|"twisted stitch"`; multi-word entries are quoted). App URL: repeated `any=`.
  Form: "All of these words" (`query`) + "Any of these words" (comma-separated).
- NL parser (user decision): pull out category/weight/yarn amount first; **everything else except
  filler goes into keywords** (including subjective words like "cozy", "quick"). Explicit
  alternatives ("cabled or lace") go to `anyKeywords`. Category/weight words the model repeats in
  keywords are stripped in code (`stripCapturedWords`), since keywords are ANDed.

Day 4 complete (2026-09-23) — enhanced project search:
- Opt-in only: "Enhanced" checkbox on the Projects tab → `GET /api/search/projects?enhanced=1`.
  Not persisted in the URL. Skipped (with a message) when no category is set.
- `lib/enhanced-project-search.ts`: Query A (normal) and Query B (`loosen()`: category → category
  names as OR'd text, page size 100) in parallel. Candidates = B minus A, minus projects whose
  linked pattern is already in the target category (`getPatternCategoryChains`, 1 batched call).
  Without that step, ~19/22 of B-only results were correctly filed projects from later A pages.
- `lib/reranker.ts`: Claude **Sonnet 5** (user's choice after a side-by-side; Haiku let through
  scarves as shawls, a scarflet as a hat) judges candidates from name/pattern name/tags only
  (project notes need a per-project call, so they aren't used). Returns reasons; only ids that
  were sent are accepted back. Re-rank failure degrades to plain results. ~6–12 s uncached.
- Recovered projects are shown in a separate "Loosely matched" section with Claude's reason.
- `lib/claude.ts`: shared lazy Anthropic client.

## Ravelry text query syntax (verified)
- Words are ANDed; `|` (or `OR`) ORs adjacent terms and binds tighter:
  `raglan coat|jacket` = raglan AND (coat OR jacket).
- `page_size` up to at least 200 is accepted for project search.

## Ravelry API findings (verified against live API)
- `weight` and `pc` (pattern category) work; `|` ORs multiple values.
- Unknown `weight`/`pc` values → Ravelry returns HTTP 500. UI/NL parser must only emit known permalinks.
- `yardage` is `min|max` (not `min-max`, which is silently ignored) and matches patterns whose
  yardage range (smallest→largest size) overlaps. Open upper bound (`800|`) returns patterns with
  no yardage, so always send both ends.
- Search result `results` count caps at 100000.
- Search results don't include yardage/weight; `/patterns.json?ids=a+b` returns full details.
- Credentials must be the Basic Auth app's generated username/password, not the account login (→ 403).

## Decisions made during build
- Ravelry auth uses a read-only "Basic Auth" app (username/password) instead of OAuth — sufficient
  for single-user local, far less plumbing. Revisit for multi-user MVP.
- Next.js 16 has breaking changes vs. older versions — see AGENTS.md; read `node_modules/next/dist/docs/`
  before writing Next-specific code.
- Node 24 LTS installed via winget at `C:\Program Files\nodejs` (Git Bash may need it prepended to
  PATH until the terminal is restarted).
- Git: this repo is configured (local git config) to commit and push as `rebecca-ann-ai` via the
  `gh` credential helper. The global identity is `rebecca-ann`; don't change it.
- Commits should be small and atomic.

## Update this file as the project progresses
When a build step from HANDOFF.md's schedule is completed, or a new architectural
decision is made, add it here so future sessions have accurate context.

@AGENTS.md
