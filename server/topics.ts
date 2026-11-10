import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Agent, asTokenUsage, extractMessageText } from "./agent.ts";
import { syncTopicsEditionToObsidian } from "./obsidian.ts";
import { readSettings } from "./store.ts";
import type {
  TokenUsage,
  TopicEntity,
  TopicEntityKind,
  TopicFigure,
  TopicSection,
  TopicSource,
  TopicStory,
  TopicsEdition,
  TopicsState,
} from "./types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const topicsPath = path.join(dataDir, "topics.json");

const emptyState = (): TopicsState => ({
  interests: [],
  edition: null,
  lifetimeUsage: emptyUsage(),
  refreshCount: 0,
});

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

export function addTokenUsage(target: TokenUsage, next?: TokenUsage): TokenUsage {
  if (!next) return target;
  return {
    inputTokens: target.inputTokens + (next.inputTokens ?? 0),
    outputTokens: target.outputTokens + (next.outputTokens ?? 0),
    cacheReadTokens: target.cacheReadTokens + (next.cacheReadTokens ?? 0),
    cacheWriteTokens: target.cacheWriteTokens + (next.cacheWriteTokens ?? 0),
    totalTokens: target.totalTokens + (next.totalTokens ?? 0),
    reasoningTokens: (target.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
  };
}

function normalizeUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Partial<TokenUsage>;
  if (typeof usage.totalTokens !== "number") return undefined;
  return {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0),
    cacheReadTokens: Number(usage.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(usage.cacheWriteTokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0),
    ...(typeof usage.reasoningTokens === "number"
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
  };
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function atomicWrite(file: string, contents: string) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file);
}

export async function readTopicsState(): Promise<TopicsState> {
  await ensureDataDir();
  try {
    const raw = await readFile(topicsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TopicsState>;
    const edition =
      parsed.edition &&
      typeof parsed.edition === "object" &&
      typeof parsed.edition.fetchedAt === "number" &&
      Array.isArray(parsed.edition.sections)
        ? ({
            ...parsed.edition,
            usage: normalizeUsage(parsed.edition.usage),
          } as TopicsEdition)
        : null;
    return {
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.filter((item): item is string => typeof item === "string")
        : [],
      edition,
      lifetimeUsage: normalizeUsage(parsed.lifetimeUsage) ?? emptyUsage(),
      refreshCount:
        typeof parsed.refreshCount === "number" && parsed.refreshCount >= 0
          ? parsed.refreshCount
          : edition
            ? 1
            : 0,
    };
  } catch {
    return emptyState();
  }
}

export async function writeTopicsState(next: TopicsState): Promise<void> {
  await ensureDataDir();
  const { refreshStatus: _status, refreshError: _error, ...persisted } = next;
  await atomicWrite(topicsPath, JSON.stringify(persisted, null, 2));
}

type RefreshMeta = {
  status: "idle" | "running" | "error";
  error?: string;
  startedAt?: number;
};

let refreshMeta: RefreshMeta = { status: "idle" };
let refreshInFlight: Promise<void> | null = null;

export function getTopicsRefreshMeta(): RefreshMeta {
  return refreshMeta;
}

export async function readTopicsStateWithRefresh(): Promise<TopicsState> {
  const state = await readTopicsState();
  if (refreshMeta.status === "running") {
    return { ...state, refreshStatus: "running" };
  }
  if (refreshMeta.status === "error") {
    return {
      ...state,
      refreshStatus: "error",
      ...(refreshMeta.error ? { refreshError: refreshMeta.error } : {}),
    };
  }
  return { ...state, refreshStatus: "idle" };
}

/** Start a background edition refresh. Safe to call while one is already running. */
export function beginTopicsRefresh(input: {
  interests: string[];
  apiKey: string;
  workspace: string;
  model?: string;
}): { started: boolean; status: RefreshMeta["status"] } {
  if (refreshMeta.status === "running" && refreshInFlight) {
    return { started: false, status: "running" };
  }

  const interests = normalizeInterests(input.interests);
  refreshMeta = { status: "running", startedAt: Date.now() };
  refreshInFlight = (async () => {
    try {
      const current = await readTopicsState();
      const edition = await refreshTopicsEdition({
        interests,
        apiKey: input.apiKey,
        workspace: input.workspace,
        model: input.model,
      });
      const next: TopicsState = {
        interests,
        edition,
        lifetimeUsage: addTokenUsage(
          current.lifetimeUsage ?? emptyUsage(),
          edition.usage,
        ),
        refreshCount: (current.refreshCount ?? 0) + 1,
      };
      await writeTopicsState(next);
      try {
        const settings = await readSettings();
        const syncResult = await syncTopicsEditionToObsidian(settings, edition);
        if (!syncResult.ok) {
          console.error("[obsidian] Topics sync failed", syncResult.reason);
        } else if (!syncResult.skipped) {
          console.log(
            `[obsidian] Synced ${syncResult.topicNotes} topics, ${syncResult.storyNotes} stories, ${syncResult.entityNotes} entities (${syncResult.skippedNotes} unchanged) to ${syncResult.vaultPath}`,
          );
        }
      } catch (syncError) {
        console.error(
          "[obsidian] Topics sync error:",
          syncError instanceof Error ? syncError.message : syncError,
        );
      }
      refreshMeta = { status: "idle" };
    } catch (error) {
      refreshMeta = {
        status: "error",
        error: error instanceof Error ? error.message : "Failed to refresh topics",
      };
    } finally {
      refreshInFlight = null;
    }
  })();

  return { started: true, status: "running" };
}

export function normalizeInterests(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const topic = item.trim().replace(/\s+/g, " ");
    if (!topic || topic.length > 80) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
    if (out.length >= 12) break;
  }
  return out;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit = 8): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
  return items.length > 0 ? items : undefined;
}

function normalizeSources(value: unknown): TopicSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: TopicSource[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const title = item.trim();
      if (title) sources.push({ title });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = asString(row.title) || asString(row.name) || asString(row.label);
    if (!title) continue;
    const url = asString(row.url);
    const publisher = asString(row.publisher) || asString(row.outlet);
    sources.push({
      title,
      ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
      ...(publisher ? { publisher } : {}),
    });
    if (sources.length >= 6) break;
  }
  return sources.length > 0 ? sources : undefined;
}

function normalizeImage(value: unknown): TopicStory["image"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const image = value as Record<string, unknown>;
  const url = asString(image.url);
  if (!/^https?:\/\//i.test(url)) return undefined;
  return {
    url,
    alt: asString(image.alt, "Topic image"),
    ...(asString(image.credit) ? { credit: asString(image.credit) } : {}),
  };
}

function normalizeFigure(value: unknown): TopicFigure | null {
  if (!value || typeof value !== "object") return null;
  const figure = value as Record<string, unknown>;
  const kind = asString(figure.kind);
  const title = asString(figure.title, "Figure");
  if (kind === "stat") {
    const val = asString(figure.value);
    if (!val) return null;
    return {
      kind: "stat",
      title,
      value: val,
      ...(asString(figure.unit) ? { unit: asString(figure.unit) } : {}),
      ...(asString(figure.hint) ? { hint: asString(figure.hint) } : {}),
    };
  }
  if (kind === "bar" || kind === "line") {
    if (!Array.isArray(figure.series)) return null;
    const series = figure.series
      .map((point) => {
        if (!point || typeof point !== "object") return null;
        const row = point as Record<string, unknown>;
        const label = asString(row.label);
        const num = typeof row.value === "number" ? row.value : Number(row.value);
        if (!label || !Number.isFinite(num)) return null;
        return { label, value: num };
      })
      .filter((point): point is { label: string; value: number } => Boolean(point))
      .slice(0, 8);
    if (series.length < 2) return null;
    return {
      kind,
      title,
      series,
      ...(asString(figure.unit) ? { unit: asString(figure.unit) } : {}),
    };
  }
  return null;
}

const MAX_STORY_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseStoryDate(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const isoDay = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) {
    const parsed = Date.parse(`${isoDay[1]}T00:00:00Z`);
    if (Number.isFinite(parsed)) return isoDay[1];
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  return date.toISOString().slice(0, 10);
}

function isStoryFresh(publishedAt: string | undefined, now = Date.now()): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(`${publishedAt}T00:00:00Z`);
  if (!Number.isFinite(published)) return false;
  const oldestAllowed = startOfUtcDay(new Date(now)) - MAX_STORY_AGE_MS;
  return published >= oldestAllowed && published <= now + 24 * 60 * 60 * 1000;
}

function normalizeStory(value: unknown): TopicStory | null {
  if (!value || typeof value !== "object") return null;
  const story = value as Record<string, unknown>;
  const title = asString(story.title);
  const summary = asString(story.summary);
  if (!title || !summary) return null;
  const publishedAt =
    parseStoryDate(story.publishedAt) ??
    parseStoryDate(story.published) ??
    parseStoryDate(story.date) ??
    parseStoryDate(story.publishedDate);
  // Drop undated or stale items — Topics is a 3-day briefing, not an archive.
  if (!isStoryFresh(publishedAt)) return null;
  const sources =
    normalizeSources(story.sources) ??
    normalizeSources(story.citations) ??
    normalizeSources(story.sourceHints);
  const sourceHints = asStringArray(story.sourceHints, 6);
  const entities = normalizeEntities(story.entities);
  return {
    title,
    summary,
    publishedAt,
    ...(asStringArray(story.bullets, 8) ? { bullets: asStringArray(story.bullets, 8) } : {}),
    ...(sources ? { sources } : {}),
    ...(!sources && sourceHints ? { sourceHints } : {}),
    ...(entities ? { entities } : {}),
    ...(normalizeImage(story.image) ? { image: normalizeImage(story.image) } : {}),
  };
}

const ENTITY_KINDS = new Set(["person", "org", "place", "product", "other"]);

function normalizeEntities(value: unknown): TopicEntity[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: TopicEntity[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const name = item.trim().replace(/\s+/g, " ");
      if (!name || name.length > 80) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
      if (out.length >= 8) break;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = asString(row.name);
    if (!name || name.length > 80) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kindRaw = asString(row.kind).toLowerCase();
    const kind = ENTITY_KINDS.has(kindRaw)
      ? (kindRaw as TopicEntityKind)
      : undefined;
    out.push(kind ? { name, kind } : { name });
    if (out.length >= 8) break;
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeSection(topic: string, raw: unknown): TopicSection {
  const today = new Date().toISOString().slice(0, 10);
  const fallback: TopicSection = {
    topic,
    headline: topic,
    dek: `No fresh stories from the last 3 days for ${topic}.`,
    stories: [
      {
        title: `No recent coverage for ${topic}`,
        summary:
          "No stories with a publish date in the last 3 days were returned. Refresh later or widen the topic.",
        publishedAt: today,
      },
    ],
    figures: [],
  };

  if (!raw || typeof raw !== "object") return fallback;
  const section = raw as Record<string, unknown>;
  const stories = Array.isArray(section.stories)
    ? section.stories
        .map(normalizeStory)
        .filter((story): story is TopicStory => Boolean(story))
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    : [];
  const figures = Array.isArray(section.figures)
    ? section.figures
        .map(normalizeFigure)
        .filter((figure): figure is TopicFigure => Boolean(figure))
        .slice(0, 5)
    : [];

  return {
    topic,
    headline: asString(section.headline, topic) || topic,
    dek:
      asString(section.dek) ||
      (stories.length > 0
        ? `Last 3 days · ${stories.length} stories`
        : `No fresh stories from the last 3 days for ${topic}.`),
    stories: stories.length > 0 ? stories.slice(0, 8) : fallback.stories,
    figures,
  };
}

function stripJsonNoise(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

/** Insert missing commas between adjacent JSON values (common LLM slip). */
function insertMissingCommas(raw: string): string {
  return raw.replace(
    /([}\]"0-9]|true|false|null)\s*(?=["{\[\-]|true\b|false\b|null\b)/g,
    (match, left: string, offset: number, source: string) => {
      // Don't touch content inside strings — approximate with quote parity.
      const before = source.slice(0, offset + String(left).length);
      let inString = false;
      let escaped = false;
      for (const ch of before) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = !inString;
      }
      if (inString) return match;
      return `${left},`;
    },
  );
}

function closeTruncatedJson(raw: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of raw) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }
  let out = raw;
  if (inString) out += '"';
  // Drop a dangling trailing comma before we close.
  out = out.replace(/,\s*$/, "");
  while (stack.length > 0) out += stack.pop();
  return out;
}

function tryParseJson(raw: string): unknown {
  return JSON.parse(raw);
}

function parseJsonLenient(raw: string): unknown {
  const attempts = [
    raw,
    stripJsonNoise(raw),
    stripJsonNoise(insertMissingCommas(raw)),
    stripJsonNoise(insertMissingCommas(closeTruncatedJson(raw))),
  ];
  let lastError: Error | undefined;
  const seen = new Set<string>();
  for (const candidate of attempts) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return tryParseJson(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Invalid JSON");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model reply did not include a JSON object");
  }
  return parseJsonLenient(candidate.slice(start, end + 1));
}

function jsonRepairPrompt(topic: string, parseError: string): string {
  return [
    `Your previous reply for topic "${topic}" was not valid JSON.`,
    `Parser error: ${parseError}`,
    "Return ONLY one corrected JSON object for that same topic.",
    "No markdown fences, no commentary.",
    "Use strict JSON: double quotes, commas between every array/object element, no trailing commas.",
    "Keep the same schema (headline, dek, stories with entities, figures) and the 3-day recency rules.",
  ].join("\n");
}

function briefingPrompt(topic: string): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const oldest = new Date(startOfUtcDay(today) - MAX_STORY_AGE_MS)
    .toISOString()
    .slice(0, 10);
  return [
    "You are preparing one newspaper section for a personal briefing app called Brief.",
    `Topic: ${topic}`,
    `Today (UTC): ${todayIso}`,
    `Recency window: only stories published from ${oldest} through ${todayIso} (last 3 days inclusive).`,
    "",
    "Return ONLY a single JSON object. No markdown outside JSON. No commentary.",
    "Strict JSON only: double quotes, a comma between every array/object element, no trailing commas, no comments.",
    "Use current, factual knowledge. If unsure, say so briefly in the summary.",
    "Prefer short sentences.",
    "",
    "Schema:",
    "{",
    '  "headline": string,',
    '  "dek": string,',
    '  "stories": [',
    "    {",
    '      "title": string,',
    '      "summary": string,',
    '      "publishedAt": "YYYY-MM-DD",',
    '      "bullets": string[] optional,',
    '      "sources": [',
    '        { "title": string, "url": https URL optional, "publisher": string optional }',
    "      ],",
    '      "entities": [',
    '        { "name": string, "kind": "person"|"org"|"place"|"product"|"other" optional }',
    "      ] optional,",
    '      "image": { "url": https URL, "alt": string, "credit": string optional } optional',
    "    }",
    "  ],",
    '  "figures": [',
    '    { "kind": "stat", "title": string, "value": string, "unit": string optional, "hint": string optional }',
    '    | { "kind": "bar"|"line", "title": string, "unit": string optional, "series": [{"label": string, "value": number}] }',
    "  ]",
    "}",
    "",
    "Rules:",
    `- HARD FILTER: every story MUST have publishedAt between ${oldest} and ${todayIso}. Do not include older evergreen explainers, week-old roundups, or undated background.`,
    "- If fewer than 5 qualifying stories exist, return only the fresh ones (do not pad with older material).",
    "- Include up to 8 distinct fresh stories covering different angles of the topic.",
    "- Every story MUST include publishedAt (YYYY-MM-DD) and 1 to 4 sources with real outlet names.",
    "- Prefer https urls for sources when you know a stable public page (news article, docs, blog). Omit url if unsure.",
    "- Include 2 to 6 entities per story (people, orgs, products, places). Prefer canonical short names. Do not list publishers as entities unless they are the subject.",
    "- Include 2 to 4 figures with realistic numeric series when possible; figures may summarize the same 3-day window.",
    "- Image URLs must be public https links (Unsplash, Wikimedia, or similar). Omit image if unsure.",
    "- Keep the whole reply under 2800 words of JSON content.",
  ].join("\n");
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export async function refreshTopicsEdition(input: {
  interests: string[];
  apiKey: string;
  workspace: string;
  model?: string;
}): Promise<TopicsEdition> {
  const interests = normalizeInterests(input.interests);
  if (interests.length === 0) {
    return { fetchedAt: Date.now(), sections: [], usage: emptyUsage() };
  }

  const modelId = !input.model || input.model === "auto" ? "default" : input.model;

  const results = await mapPool(interests, 2, async (topic) => {
    let agent: Awaited<ReturnType<typeof Agent.create>> | null = null;
    let usage = emptyUsage();
    try {
      agent = await Agent.create({
        apiKey: input.apiKey,
        model: { id: modelId },
        local: { cwd: input.workspace },
      } as Parameters<typeof Agent.create>[0]);

      const runPrompt = async (prompt: string) => {
        let streamed = "";
        const run = await agent!.send(prompt, {
          model: { id: modelId },
          local: { force: true },
          onDelta: ({ update }) => {
            if (update.type === "text-delta" && typeof update.text === "string") {
              streamed += update.text;
            }
          },
        });
        const result = await run.wait();
        usage = addTokenUsage(
          usage,
          asTokenUsage(
            (result as { usage?: unknown }).usage ??
              (result as { result?: { usage?: unknown } }).result,
          ),
        );
        if (result.status === "error") {
          throw Object.assign(
            new Error(result.error?.message ?? "Topic briefing failed"),
            { usage },
          );
        }
        const text = result.result?.trim() || streamed.trim() || extractMessageText(result);
        if (!text) throw Object.assign(new Error("Empty briefing response"), { usage });
        return text;
      };

      const text = await runPrompt(briefingPrompt(topic));
      let parsed: unknown;
      try {
        parsed = extractJsonObject(text);
      } catch (parseError) {
        const message =
          parseError instanceof Error ? parseError.message : "Invalid JSON";
        const repaired = await runPrompt(jsonRepairPrompt(topic, message));
        parsed = extractJsonObject(repaired);
      }
      return { section: normalizeSection(topic, parsed), usage };
    } catch (error) {
      return {
        section: {
          topic,
          headline: topic,
          dek: "This section could not be refreshed.",
          stories: [
            {
              title: "Refresh failed",
              summary: error instanceof Error ? error.message : "Unknown error",
            },
          ],
          figures: [],
          error: error instanceof Error ? error.message : "Unknown error",
        } satisfies TopicSection,
        usage:
          error && typeof error === "object" && "usage" in error
            ? addTokenUsage(usage, (error as { usage?: TokenUsage }).usage)
            : usage,
      };
    } finally {
      if (agent) {
        try {
          await agent[Symbol.asyncDispose]();
        } catch {
          agent.close();
        }
      }
    }
  });

  let usage = emptyUsage();
  for (const row of results) usage = addTokenUsage(usage, row.usage);

  return {
    fetchedAt: Date.now(),
    sections: results.map((row) => row.section),
    usage,
  };
}

export function storyCount(edition: TopicsEdition | null | undefined): number {
  if (!edition) return 0;
  return edition.sections.reduce((sum, section) => sum + section.stories.length, 0);
}
