import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SavedStory, TopicEntity, TopicEntityKind } from "./types.ts";

const ENTITY_KINDS = new Set(["person", "org", "place", "product", "other"]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const savedPath = path.join(dataDir, "saved.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function atomicWrite(file: string, contents: string) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file);
}

export async function readSavedStories(): Promise<SavedStory[]> {
  await ensureDataDir();
  try {
    const raw = await readFile(savedPath, "utf8");
    const parsed = JSON.parse(raw) as { items?: SavedStory[] } | SavedStory[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item === "object" && typeof item.id === "string")
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

async function writeSavedStories(items: SavedStory[]): Promise<void> {
  await ensureDataDir();
  await atomicWrite(savedPath, JSON.stringify({ items }, null, 2));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeSavedInput(body: unknown): Omit<SavedStory, "id" | "savedAt"> | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const topic = asString(value.topic);
  const title = asString(value.title);
  const summary = asString(value.summary);
  if (!topic || !title || !summary) return null;

  let image: SavedStory["image"];
  if (value.image && typeof value.image === "object") {
    const img = value.image as Record<string, unknown>;
    const url = asString(img.url);
    if (/^https?:\/\//i.test(url)) {
      image = {
        url,
        alt: asString(img.alt, title),
        ...(asString(img.credit) ? { credit: asString(img.credit) } : {}),
      };
    }
  }

  const bullets = Array.isArray(value.bullets)
    ? value.bullets.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : undefined;
  const sourceHints = Array.isArray(value.sourceHints)
    ? value.sourceHints.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : undefined;
  const sources = Array.isArray(value.sources)
    ? value.sources
        .map((item) => {
          if (typeof item === "string") {
            const title = item.trim();
            return title ? { title } : null;
          }
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const sourceTitle =
            typeof row.title === "string"
              ? row.title.trim()
              : typeof row.name === "string"
                ? row.name.trim()
                : "";
          if (!sourceTitle) return null;
          const url = typeof row.url === "string" ? row.url.trim() : "";
          const publisher =
            typeof row.publisher === "string"
              ? row.publisher.trim()
              : typeof row.outlet === "string"
                ? row.outlet.trim()
                : "";
          return {
            title: sourceTitle,
            ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
            ...(publisher ? { publisher } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 6)
    : undefined;

  const entities = Array.isArray(value.entities)
    ? (() => {
        const seen = new Set<string>();
        const out: TopicEntity[] = [];
        for (const item of value.entities) {
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
          const name =
            typeof row.name === "string" ? row.name.trim().replace(/\s+/g, " ") : "";
          if (!name || name.length > 80) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const kindRaw =
            typeof row.kind === "string" ? row.kind.trim().toLowerCase() : "";
          const kind = ENTITY_KINDS.has(kindRaw)
            ? (kindRaw as TopicEntityKind)
            : undefined;
          out.push(kind ? { name, kind } : { name });
          if (out.length >= 8) break;
        }
        return out;
      })()
    : undefined;

  return {
    topic,
    title,
    summary,
    ...(bullets && bullets.length ? { bullets } : {}),
    ...(sources && sources.length ? { sources } : {}),
    ...(sourceHints && sourceHints.length ? { sourceHints } : {}),
    ...(entities && entities.length ? { entities } : {}),
    ...(image ? { image } : {}),
  };
}

export async function saveStory(
  input: Omit<SavedStory, "id" | "savedAt">,
): Promise<{ item: SavedStory; created: boolean }> {
  const items = await readSavedStories();
  const existing = items.find(
    (item) =>
      item.topic.toLowerCase() === input.topic.toLowerCase() &&
      item.title.toLowerCase() === input.title.toLowerCase(),
  );
  if (existing) return { item: existing, created: false };

  const item: SavedStory = {
    ...input,
    id: randomUUID(),
    savedAt: Date.now(),
  };
  await writeSavedStories([item, ...items]);
  return { item, created: true };
}

export async function deleteSavedStory(id: string): Promise<boolean> {
  const items = await readSavedStories();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeSavedStories(next);
  return true;
}
