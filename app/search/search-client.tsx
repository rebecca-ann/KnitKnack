"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";
import { type SearchFilters, type YarnWeight, YARN_WEIGHTS, toQueryString } from "@/lib/filters";
import type {
  Paginator,
  PatternCategory,
  PatternSummary,
  ProjectSummary,
  RavelryPhoto,
} from "@/lib/ravelry-client";
import type { RecoveredProject } from "@/lib/enhanced-project-search";
import styles from "./search.module.css";

export type SearchKind = "patterns" | "projects";

export type SearchResults =
  | { kind: "patterns"; patterns: PatternSummary[]; paginator: Paginator }
  | {
      kind: "projects";
      projects: ProjectSummary[];
      paginator: Paginator;
      enhanced?: { recovered: RecoveredProject[]; candidatesReviewed: number } | { skipped: string };
    };

interface Props {
  categories: PatternCategory[];
  initialKind: SearchKind;
  initialFilters: SearchFilters;
  initialResults: SearchResults | null;
}

// Form state keeps raw input strings; SearchFilters is built on submit.
interface FormState {
  query: string;
  /** Comma-separated; each entry may be a multi-word phrase. */
  anyKeywords: string;
  weights: YarnWeight[];
  category: string;
  yardMin: string;
  yardMax: string;
}

function toFormState(f: SearchFilters): FormState {
  return {
    query: f.query ?? "",
    anyKeywords: f.anyKeywords?.join(", ") ?? "",
    weights: f.weights ?? [],
    category: f.categories?.[0] ?? "",
    yardMin: f.yardage?.min?.toString() ?? "",
    yardMax: f.yardage?.max?.toString() ?? "",
  };
}

function toFilters(form: FormState, page: number): SearchFilters {
  const num = (s: string) => (s.trim() === "" ? undefined : Math.max(0, Math.floor(Number(s))));
  const min = num(form.yardMin);
  const max = num(form.yardMax);
  const anyKeywords = form.anyKeywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return {
    query: form.query.trim() || undefined,
    anyKeywords: anyKeywords.length ? anyKeywords : undefined,
    weights: form.weights.length ? form.weights : undefined,
    categories: form.category ? [form.category] : undefined,
    yardage: min !== undefined || max !== undefined ? { min, max } : undefined,
    page,
  };
}

function searchUrl(kind: SearchKind, filters: SearchFilters): string {
  const qs = toQueryString(filters);
  return kind === "projects" ? `kind=projects${qs ? `&${qs}` : ""}` : qs;
}

export default function SearchClient({ categories, initialKind, initialFilters, initialResults }: Props) {
  const [kind, setKind] = useState<SearchKind>(initialKind);
  const [form, setForm] = useState<FormState>(() => toFormState(initialFilters));
  const [results, setResults] = useState<SearchResults | null>(initialResults);
  // Filters behind the displayed results; paging reuses these, not unsubmitted form edits.
  const [activeFilters, setActiveFilters] = useState<SearchFilters>(initialFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nlText, setNlText] = useState("");
  const [parsing, setParsing] = useState(false);
  // Enhanced project search: opt-in per session, never persisted in the URL (it adds API cost).
  const [enhanced, setEnhanced] = useState(false);

  async function runSearch(searchKind: SearchKind, filters: SearchFilters, withEnhanced = enhanced) {
    setLoading(true);
    setError(null);
    try {
      const extra = searchKind === "projects" && withEnhanced ? "&enhanced=1" : "";
      const res = await fetch(`/api/search/${searchKind}?${toQueryString(filters)}${extra}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);
      setResults({ kind: searchKind, ...body });
      setActiveFilters(filters);
      window.history.replaceState(null, "", `/search?${searchUrl(searchKind, filters)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(kind, toFilters(form, 1));
  }

  // NL text → /api/parse → SearchFilters → form fields → normal search path. The form is
  // the source of truth, so the user sees (and can tweak) exactly how the text was read.
  async function onNlSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nlText.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Couldn't interpret search (${res.status})`);
      if (Object.values(body.filters).every((v) => v === undefined || v === null)) {
        throw new Error("Nothing specific to search on. Try naming an item, a yarn weight, or an amount of yarn.");
      }
      const next = toFormState(body.filters);
      setForm(next);
      await runSearch(kind, toFilters(next, 1));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function switchKind(next: SearchKind) {
    if (next === kind) return;
    setKind(next);
    if (results) runSearch(next, { ...activeFilters, page: 1 });
  }

  function toggleEnhanced(on: boolean) {
    setEnhanced(on);
    if (results?.kind === "projects") runSearch("projects", { ...activeFilters, page: 1 }, on);
  }

  function goToPage(page: number) {
    runSearch(kind, { ...activeFilters, page });
  }

  function toggleWeight(w: YarnWeight) {
    setForm((f) => ({
      ...f,
      weights: f.weights.includes(w) ? f.weights.filter((x) => x !== w) : [...f.weights, w],
    }));
  }

  const paginator = results?.paginator;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>KnitKnack</h1>

      <div className={styles.tabs} role="tablist">
        {(["patterns", "projects"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? styles.tabActive : styles.tab}
            onClick={() => switchKind(k)}
          >
            {k === "patterns" ? "Patterns" : "Projects"}
          </button>
        ))}
      </div>

      <form className={styles.nlForm} onSubmit={onNlSubmit}>
        <input
          type="search"
          aria-label="Describe what you're looking for"
          value={nlText}
          maxLength={500}
          placeholder="Describe it, e.g. “men's cabled cardigan in 8 ply, around 1000 m”"
          onChange={(e) => setNlText(e.target.value)}
        />
        <button type="submit" className={styles.submit} disabled={parsing || loading || !nlText.trim()}>
          {parsing ? "Interpreting…" : "Ask"}
        </button>
      </form>

      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span>All of these words (a|b = either)</span>
          <input
            type="search"
            value={form.query}
            placeholder="e.g. raglan fall|autumn"
            onChange={(e) => setForm({ ...form, query: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span>Any of these words (comma-separated)</span>
          <input
            type="search"
            value={form.anyKeywords}
            placeholder="e.g. cabled, lace, twisted stitch"
            onChange={(e) => setForm({ ...form, anyKeywords: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span>Category</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Any</option>
            {categories.map((c) => (
              <option key={c.permalink} value={c.permalink}>
                {"  ".repeat(c.depth) + c.name}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.yardage}>
          <label className={styles.field}>
            <span>Yardage min</span>
            <input
              type="number"
              min={0}
              value={form.yardMin}
              onChange={(e) => setForm({ ...form, yardMin: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Yardage max</span>
            <input
              type="number"
              min={0}
              value={form.yardMax}
              onChange={(e) => setForm({ ...form, yardMax: e.target.value })}
            />
          </label>
        </div>

        <fieldset className={styles.weights}>
          <legend>Yarn weight</legend>
          {YARN_WEIGHTS.map((w) => (
            <label key={w} className={form.weights.includes(w) ? styles.chipOn : styles.chip}>
              <input type="checkbox" checked={form.weights.includes(w)} onChange={() => toggleWeight(w)} />
              {w}
            </label>
          ))}
        </fieldset>

        {kind === "projects" && (
          <label className={styles.toggle}>
            <input type="checkbox" checked={enhanced} onChange={(e) => toggleEnhanced(e.target.checked)} />
            <span>
              Enhanced: also find projects filed under the wrong category
              <small>Needs a category. Uses Claude; takes ~10 s per search.</small>
            </span>
          </label>
        )}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? (kind === "projects" && enhanced ? "Searching (enhanced)…" : "Searching…") : "Search"}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {results && paginator && (
        <section aria-busy={loading}>
          <p className={styles.summary}>
            {paginator.results.toLocaleString()}
            {paginator.results >= 100000 ? "+" : ""} results · page {paginator.page} of{" "}
            {paginator.page_count.toLocaleString()}
          </p>

          <ul className={styles.grid}>
            {results.kind === "patterns"
              ? results.patterns.map((p) => (
                  <ResultCard
                    key={p.id}
                    href={`https://www.ravelry.com/patterns/library/${p.permalink}`}
                    photo={p.first_photo}
                    title={p.name}
                    subtitle={[p.designer?.name, p.free ? "Free" : null].filter(Boolean).join(" · ")}
                  />
                ))
              : results.projects.map((p) => <ProjectCard key={p.id} project={p} />)}
          </ul>

          {results.kind === "projects" && results.enhanced && (
            <div className={styles.recovered}>
              {"skipped" in results.enhanced ? (
                <p className={styles.summary}>Enhanced search skipped: {results.enhanced.skipped}</p>
              ) : (
                <>
                  <h2>Loosely matched</h2>
                  <p className={styles.summary}>
                    Filed under a different category (or none) on Ravelry, but Claude judged them a match.{" "}
                    {results.enhanced.recovered.length} of {results.enhanced.candidatesReviewed} reviewed.
                  </p>
                  {results.enhanced.recovered.length > 0 && (
                    <ul className={styles.grid}>
                      {results.enhanced.recovered.map((r) => (
                        <ProjectCard key={r.project.id} project={r.project} note={r.reason} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <nav className={styles.pager}>
            <button disabled={loading || paginator.page <= 1} onClick={() => goToPage(paginator.page - 1)}>
              ← Prev
            </button>
            <button
              disabled={loading || paginator.page >= paginator.last_page}
              onClick={() => goToPage(paginator.page + 1)}
            >
              Next →
            </button>
          </nav>
        </section>
      )}
    </main>
  );
}

function ProjectCard({ project: p, note }: { project: ProjectSummary; note?: string }) {
  return (
    <ResultCard
      href={p.links?.self?.href ?? `https://www.ravelry.com/projects/${p.user?.username}/${p.permalink}`}
      photo={p.first_photo}
      title={p.name}
      subtitle={[p.pattern_name, p.user?.username, p.status_name].filter(Boolean).join(" · ")}
      note={note}
    />
  );
}

function ResultCard(props: {
  href: string;
  photo?: RavelryPhoto | null;
  title: string;
  subtitle: string;
  note?: string;
}) {
  const src = props.photo?.medium_url ?? props.photo?.small_url;
  return (
    <li className={styles.card}>
      <a href={props.href} target="_blank" rel="noreferrer">
        <div className={styles.thumb}>
          {src ? <Image src={src} alt="" fill sizes="220px" /> : <span>No photo</span>}
        </div>
        <div className={styles.cardText}>
          <strong>{props.title}</strong>
          {props.subtitle && <span>{props.subtitle}</span>}
          {props.note && <em className={styles.note}>{props.note}</em>}
        </div>
      </a>
    </li>
  );
}
