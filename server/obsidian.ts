import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppSettings,
  ObsidianSyncStatus,
  SavedStory,
  TopicEntity,
  TopicSection,
  TopicSource,
  TopicStory,
  TopicsEdition,
} from "./types.ts";

export const DEFAULT_OBSIDIAN_VAULT =
  process.env.OBSIDIAN_VAULT?.trim() ||
  "/home/pi5/.t3/scratch/2026-11-10-setup-obsidian-and-then-deploy-a5ec2c7e/config/Obsidian Vault";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncStatusPath = path.join(root, "data", "obsidian-sync.json");

const BRIEF_ROOT = "Brief";
const TOPICS_DIR = path.join(BRIEF_ROOT, "Topics");
const STORIES_DIR = path.join(BRIEF_ROOT, "Stories");
const ENTITIES_DIR = path.join(BRIEF_ROOT, "Entities");
const CHATS_DIR = path.join(BRIEF_ROOT, "Chats");
const GENERATED_MARKER = "<!-- brief:generated -->";
const USER_MARKER = "<!-- brief:user -->";

export type ObsidianSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  topicNotes: number;
  storyNotes: number;
  entityNotes: number;
  skippedNotes: number;
  vaultPath?: string;
};

export type ObsidianSyncOptions = {
  enabled: boolean;
  vaultPath: string;
};

type StorySourceTag = "brief-topics" | "brief-saved";

type EntityMention = {
  name: string;
  kind?: TopicEntity["kind"];
  notePath: string;
  mentionedIn: { title: string; notePath: string }[];
};

export function resolveObsidianSync(settings: AppSettings): ObsidianSyncOptions {
  return {
    enabled: Boolean(settings.obsidianEnabled),
    vaultPath: settings.obsidianVault?.trim() || DEFAULT_OBSIDIAN_VAULT,
  };
}

/** Resolve the cwd used by local agents (chat + Topics). */
export function resolveAgentWorkspace(
  settings: AppSettings,
  overrides?: { useObsidianWorkspace?: boolean },
): string {
  const useVault = overrides?.useObsidianWorkspace ?? settings.obsidianUseAsWorkspace;
  if (settings.obsidianEnabled && useVault) {
    return settings.obsidianVault?.trim() || DEFAULT_OBSIDIAN_VAULT;
  }
  return settings.workspace;
}

export function slugifyFilename(raw: string, maxLength = 80): string {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\/\\:\*\?"<>\|#^\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "untitled";
  return base.length > maxLength ? base.slice(0, maxLength).trim() : base;
}

export function topicNoteId(topic: string): string {
  return `brief:topic:${topic.trim().toLowerCase()}`;
}

export function storyNoteId(topic: string, title: string): string {
  const key = `${topic.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `brief:story:${hash}`;
}

export function entityNoteId(name: string): string {
  return `brief:entity:${name.trim().toLowerCase()}`;
}

export function chatNoteId(chatId: string): string {
  const hash = createHash("sha256").update(chatId.trim()).digest("hex").slice(0, 12);
  return `brief:chat:${hash}`;
}

export type ChatObsidianMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

export type ChatObsidianInput = {
  chatId: string;
  chatTitle: string;
  messages: ChatObsidianMessage[];
};

export type ChatObsidianSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  notePath?: string;
  vaultPath?: string;
  messageCount?: number;
};

export function stableContentHash(markdown: string): string {
  const stable = markdown
    .replace(/^syncedAt:.*$/gm, "syncedAt: <volatile>")
    .replace(/^contentHash:.*$/gm, "contentHash: <volatile>");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function wikiLink(notePathWithoutExt: string, display?: string): string {
  if (display && display !== path.basename(notePathWithoutExt)) {
    return `[[${notePathWithoutExt}|${display}]]`;
  }
  return `[[${notePathWithoutExt}]]`;
}

function yamlEscape(value: string): string {
  if (/[:#\[\]{},&*?|>!%@`]/.test(value) || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatFrontmatter(
  fields: Record<string, string | number | boolean | string[]>,
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${yamlEscape(item)}`);
      }
    } else if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlEscape(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function injectContentHash(markdown: string, hash: string): string {
  if (markdown.startsWith("---\n")) {
    return markdown.replace(/^---\n/, `---\ncontentHash: ${hash}\n`);
  }
  return `---\ncontentHash: ${hash}\n---\n\n${markdown}`;
}

function extractContentHash(markdown: string): string | undefined {
  const match = markdown.match(/^contentHash:\s*["']?([a-f0-9]+)["']?\s*$/m);
  return match?.[1];
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file);
}

function storyFilename(topic: string, title: string): string {
  const base = slugifyFilename(title);
  const id = storyNoteId(topic, title).replace("brief:story:", "");
  return `${base} (${id})`;
}

function topicFilename(topic: string): string {
  return slugifyFilename(topic);
}

function entityFilename(name: string): string {
  return slugifyFilename(name);
}

function mergeUserSection(existing: string | undefined, generated: string): string {
  if (!existing) return generated;
  const userSplit = existing.split(new RegExp(`\\n${USER_MARKER}\\n`));
  if (userSplit.length <= 1) return generated;
  return `${generated.trimEnd()}\n\n${USER_MARKER}\n${userSplit.slice(1).join(`\n${USER_MARKER}\n`)}`;
}

async function writeNoteIfChanged(
  filePath: string,
  generated: string,
): Promise<"written" | "skipped"> {
  const hash = stableContentHash(generated);
  const withHash = injectContentHash(generated, hash);
  let existing: string | undefined;
  try {
    existing = await readFile(filePath, "utf8");
    if (extractContentHash(existing) === hash) return "skipped";
  } catch {
    existing = undefined;
  }
  const merged = mergeUserSection(existing, withHash);
  await atomicWrite(filePath, merged);
  return "written";
}

function entitiesFromStory(story: TopicStory): TopicEntity[] {
  const out: TopicEntity[] = [];
  const seen = new Set<string>();
  for (const entity of story.entities ?? []) {
    const name = entity.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity.kind ? { name, kind: entity.kind } : { name });
  }
  for (const source of story.sources ?? []) {
    const publisher = source.publisher?.trim();
    if (!publisher) continue;
    const key = publisher.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: publisher, kind: "org" });
  }
  return out.slice(0, 12);
}

function rememberEntity(
  map: Map<string, EntityMention>,
  entity: TopicEntity,
  mention: { title: string; notePath: string },
): { name: string; notePath: string } {
  const notePath = path.join(ENTITIES_DIR, entityFilename(entity.name));
  const key = entity.name.toLowerCase();
  const existing = map.get(key);
  if (existing) {
    if (entity.kind && !existing.kind) existing.kind = entity.kind;
    if (!existing.mentionedIn.some((item) => item.notePath === mention.notePath)) {
      existing.mentionedIn.push(mention);
    }
  } else {
    map.set(key, {
      name: entity.name,
      kind: entity.kind,
      notePath,
      mentionedIn: [mention],
    });
  }
  return { name: entity.name, notePath };
}

export function renderTopicNote(input: {
  section: TopicSection;
  syncedAt: number;
  editionFetchedAt: number;
  storyPaths: { title: string; notePath: string }[];
}): string {
  const { section, syncedAt, editionFetchedAt, storyPaths } = input;
  const frontmatter = formatFrontmatter({
    id: topicNoteId(section.topic),
    source: "brief-topics",
    type: "topic",
    topic: section.topic,
    title: section.headline || section.topic,
    syncedAt: new Date(syncedAt).toISOString(),
    editionFetchedAt: new Date(editionFetchedAt).toISOString(),
    tags: ["brief", "brief-topics", "topic"],
  });

  const lines: string[] = [
    frontmatter,
    GENERATED_MARKER,
    "",
    `# ${section.topic}`,
    "",
    `**${section.headline}**`,
    "",
    section.dek,
    "",
    "## Stories",
    "",
  ];

  if (storyPaths.length === 0) {
    lines.push("_No stories in this edition._", "");
  } else {
    for (const story of storyPaths) {
      lines.push(`- ${wikiLink(story.notePath, story.title)}`);
    }
    lines.push("");
  }

  if (section.figures.length > 0) {
    lines.push("## Figures", "");
    for (const figure of section.figures) {
      if (figure.kind === "stat") {
        lines.push(
          `- **${figure.title}:** ${figure.value}${figure.unit ? ` ${figure.unit}` : ""}${figure.hint ? ` — ${figure.hint}` : ""}`,
        );
      } else {
        const series = figure.series
          .map((point) => `${point.label}: ${point.value}`)
          .join("; ");
        lines.push(`- **${figure.title}** (${figure.kind}): ${series}`);
      }
    }
    lines.push("");
  }

  if (section.error) {
    lines.push("> Refresh warning:", "", "```", section.error, "```", "");
  }

  return lines.join("\n");
}

export function renderStoryNote(input: {
  topic: string;
  story: TopicStory;
  syncedAt: number;
  editionFetchedAt?: number;
  topicNotePath: string;
  entityPaths: { name: string; notePath: string }[];
  source: StorySourceTag;
}): string {
  const {
    topic,
    story,
    syncedAt,
    editionFetchedAt,
    topicNotePath,
    entityPaths,
    source,
  } = input;
  const frontmatter = formatFrontmatter({
    id: storyNoteId(topic, story.title),
    source,
    type: "story",
    topic,
    title: story.title,
    ...(story.publishedAt ? { publishedAt: story.publishedAt } : {}),
    syncedAt: new Date(syncedAt).toISOString(),
    ...(editionFetchedAt
      ? { editionFetchedAt: new Date(editionFetchedAt).toISOString() }
      : {}),
    tags: ["brief", source, "story"],
  });

  const lines: string[] = [
    frontmatter,
    GENERATED_MARKER,
    "",
    `# ${story.title}`,
    "",
    `Topic: ${wikiLink(topicNotePath, topic)}`,
    "",
  ];

  if (story.publishedAt) {
    lines.push(`Published: ${story.publishedAt}`, "");
  }

  lines.push(story.summary, "");

  if (story.bullets && story.bullets.length > 0) {
    lines.push("## Key points", "");
    for (const bullet of story.bullets) lines.push(`- ${bullet}`);
    lines.push("");
  }

  if (entityPaths.length > 0) {
    lines.push("## Entities", "");
    for (const entity of entityPaths) {
      lines.push(`- ${wikiLink(entity.notePath, entity.name)}`);
    }
    lines.push("");
  }

  const sources: TopicSource[] =
    story.sources && story.sources.length > 0
      ? story.sources
      : (story.sourceHints ?? []).map((hint) => ({ title: hint }));

  if (sources.length > 0) {
    lines.push("## Sources", "");
    for (const sourceRow of sources) {
      const label = sourceRow.publisher
        ? `${sourceRow.title} (${sourceRow.publisher})`
        : sourceRow.title;
      if (sourceRow.url) lines.push(`- [${label}](${sourceRow.url})`);
      else lines.push(`- ${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderEntityNote(input: {
  name: string;
  kind?: TopicEntity["kind"];
  syncedAt: number;
  mentionedIn: { title: string; notePath: string }[];
}): string {
  const { name, kind, syncedAt, mentionedIn } = input;
  const frontmatter = formatFrontmatter({
    id: entityNoteId(name),
    source: "brief-topics",
    type: "entity",
    title: name,
    ...(kind ? { kind } : {}),
    syncedAt: new Date(syncedAt).toISOString(),
    tags: ["brief", "brief-topics", "entity", ...(kind ? [`entity/${kind}`] : [])],
  });

  const lines: string[] = [
    frontmatter,
    GENERATED_MARKER,
    "",
    `# ${name}`,
    "",
  ];
  if (kind) lines.push(`Kind: ${kind}`, "");
  lines.push("Mentioned in:", "");
  for (const item of mentionedIn) {
    lines.push(`- ${wikiLink(item.notePath, item.title)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderIndexNote(input: {
  topics: { name: string; notePath: string }[];
  syncedAt: number;
  editionFetchedAt: number;
  storyCount: number;
}): string {
  const { topics, syncedAt, editionFetchedAt, storyCount } = input;
  const frontmatter = formatFrontmatter({
    id: "brief:index",
    source: "brief-topics",
    type: "index",
    title: "Brief Index",
    syncedAt: new Date(syncedAt).toISOString(),
    editionFetchedAt: new Date(editionFetchedAt).toISOString(),
    tags: ["brief", "brief-topics", "index"],
  });

  const lines: string[] = [
    frontmatter,
    GENERATED_MARKER,
    "",
    "# Brief",
    "",
    `Last sync: ${new Date(syncedAt).toLocaleString()}`,
    "",
    `Edition fetched: ${new Date(editionFetchedAt).toLocaleString()}`,
    "",
    `${topics.length} topics · ${storyCount} stories`,
    "",
    "## Topics",
    "",
  ];

  if (topics.length === 0) {
    lines.push("_No topics synced._", "");
  } else {
    for (const topic of topics) {
      lines.push(`- ${wikiLink(topic.notePath, topic.name)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function readObsidianSyncStatus(): Promise<ObsidianSyncStatus> {
  try {
    const raw = await readFile(syncStatusPath, "utf8");
    const parsed = JSON.parse(raw) as ObsidianSyncStatus;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeObsidianSyncStatus(status: ObsidianSyncStatus): Promise<void> {
  await mkdir(path.dirname(syncStatusPath), { recursive: true });
  await atomicWrite(syncStatusPath, JSON.stringify(status, null, 2));
}

export async function recordObsidianSyncSuccess(
  result: ObsidianSyncResult,
): Promise<void> {
  const previous = await readObsidianSyncStatus();
  await writeObsidianSyncStatus({
    ...previous,
    lastSuccessAt: Date.now(),
    lastError: undefined,
    lastTopicNotes: result.topicNotes,
    lastStoryNotes: result.storyNotes,
    lastEntityNotes: result.entityNotes,
    lastSkippedNotes: result.skippedNotes,
    vaultPath: result.vaultPath,
  });
}

export async function recordObsidianSyncError(error: string): Promise<void> {
  const previous = await readObsidianSyncStatus();
  await writeObsidianSyncStatus({
    ...previous,
    lastErrorAt: Date.now(),
    lastError: error,
  });
}

async function writeEntityNotes(
  vaultPath: string,
  entityMentions: Map<string, EntityMention>,
  syncedAt: number,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const entity of entityMentions.values()) {
    const generated = renderEntityNote({
      name: entity.name,
      kind: entity.kind,
      syncedAt,
      mentionedIn: entity.mentionedIn,
    });
    const outcome = await writeNoteIfChanged(
      path.join(vaultPath, `${entity.notePath}.md`),
      generated,
    );
    if (outcome === "written") written += 1;
    else skipped += 1;
  }
  return { written, skipped };
}

export async function syncTopicsEditionToObsidian(
  settings: AppSettings,
  edition: TopicsEdition,
): Promise<ObsidianSyncResult> {
  const sync = resolveObsidianSync(settings);
  if (!sync.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "Obsidian sync is disabled",
      topicNotes: 0,
      storyNotes: 0,
      entityNotes: 0,
      skippedNotes: 0,
    };
  }

  try {
    const vaultPath = path.resolve(sync.vaultPath);
    const syncedAt = Date.now();
    const entityMentions = new Map<string, EntityMention>();
    const topicLinks: { name: string; notePath: string }[] = [];
    let storyNotes = 0;
    let topicNotes = 0;
    let skippedNotes = 0;

    for (const section of edition.sections) {
      const topicFile = topicFilename(section.topic);
      const topicNotePath = path.join(TOPICS_DIR, topicFile);
      topicLinks.push({ name: section.topic, notePath: topicNotePath });

      const storyPaths: { title: string; notePath: string }[] = [];

      for (const story of section.stories) {
        const storyFile = storyFilename(section.topic, story.title);
        const storyNotePath = path.join(STORIES_DIR, storyFile);
        storyPaths.push({ title: story.title, notePath: storyNotePath });

        const entityPaths: { name: string; notePath: string }[] = [];
        const mention = { title: story.title, notePath: storyNotePath };
        for (const entity of entitiesFromStory(story)) {
          entityPaths.push(rememberEntity(entityMentions, entity, mention));
        }

        const storyMarkdown = renderStoryNote({
          topic: section.topic,
          story,
          syncedAt,
          editionFetchedAt: edition.fetchedAt,
          topicNotePath,
          entityPaths,
          source: "brief-topics",
        });
        const storyOutcome = await writeNoteIfChanged(
          path.join(vaultPath, `${storyNotePath}.md`),
          storyMarkdown,
        );
        if (storyOutcome === "written") storyNotes += 1;
        else skippedNotes += 1;
      }

      const topicMarkdown = renderTopicNote({
        section,
        syncedAt,
        editionFetchedAt: edition.fetchedAt,
        storyPaths,
      });
      const topicOutcome = await writeNoteIfChanged(
        path.join(vaultPath, `${topicNotePath}.md`),
        topicMarkdown,
      );
      if (topicOutcome === "written") topicNotes += 1;
      else skippedNotes += 1;
    }

    const entityResult = await writeEntityNotes(vaultPath, entityMentions, syncedAt);
    skippedNotes += entityResult.skipped;

    const exactStoryCount = edition.sections.reduce(
      (sum, section) => sum + section.stories.length,
      0,
    );
    const indexOutcome = await writeNoteIfChanged(
      path.join(vaultPath, BRIEF_ROOT, "Index.md"),
      renderIndexNote({
        topics: topicLinks,
        syncedAt,
        editionFetchedAt: edition.fetchedAt,
        storyCount: exactStoryCount,
      }),
    );
    if (indexOutcome === "skipped") skippedNotes += 1;

    const result: ObsidianSyncResult = {
      ok: true,
      topicNotes,
      storyNotes,
      entityNotes: entityResult.written,
      skippedNotes,
      vaultPath,
    };
    await recordObsidianSyncSuccess(result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Obsidian sync failed";
    await recordObsidianSyncError(message);
    return {
      ok: false,
      reason: message,
      topicNotes: 0,
      storyNotes: 0,
      entityNotes: 0,
      skippedNotes: 0,
    };
  }
}

export async function syncSavedStoryToObsidian(
  settings: AppSettings,
  saved: SavedStory,
): Promise<ObsidianSyncResult> {
  const sync = resolveObsidianSync(settings);
  if (!sync.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "Obsidian sync is disabled",
      topicNotes: 0,
      storyNotes: 0,
      entityNotes: 0,
      skippedNotes: 0,
    };
  }

  try {
    const vaultPath = path.resolve(sync.vaultPath);
    const syncedAt = Date.now();
    const topicNotePath = path.join(TOPICS_DIR, topicFilename(saved.topic));
    const storyNotePath = path.join(
      STORIES_DIR,
      storyFilename(saved.topic, saved.title),
    );
    const entityMentions = new Map<string, EntityMention>();
    const story: TopicStory = {
      title: saved.title,
      summary: saved.summary,
      ...(saved.bullets ? { bullets: saved.bullets } : {}),
      ...(saved.sources ? { sources: saved.sources } : {}),
      ...(saved.sourceHints ? { sourceHints: saved.sourceHints } : {}),
      ...(saved.entities ? { entities: saved.entities } : {}),
      ...(saved.image ? { image: saved.image } : {}),
    };
    const mention = { title: saved.title, notePath: storyNotePath };
    const entityPaths = entitiesFromStory(story).map((entity) =>
      rememberEntity(entityMentions, entity, mention),
    );

    const storyMarkdown = renderStoryNote({
      topic: saved.topic,
      story,
      syncedAt,
      topicNotePath,
      entityPaths,
      source: "brief-saved",
    });
    const storyOutcome = await writeNoteIfChanged(
      path.join(vaultPath, `${storyNotePath}.md`),
      storyMarkdown,
    );

    // Ensure a lightweight topic hub exists so the story is reachable from Topics/.
    const topicSection: TopicSection = {
      topic: saved.topic,
      headline: saved.topic,
      dek: "Saved stories from Brief.",
      stories: [story],
      figures: [],
    };
    let topicNotes = 0;
    let skippedNotes = storyOutcome === "skipped" ? 1 : 0;
    try {
      const existingTopic = await readFile(
        path.join(vaultPath, `${topicNotePath}.md`),
        "utf8",
      );
      if (!existingTopic.includes(storyNotePath)) {
        const appended = `${existingTopic.trimEnd()}\n- ${wikiLink(storyNotePath, saved.title)}\n`;
        await atomicWrite(path.join(vaultPath, `${topicNotePath}.md`), appended);
        topicNotes = 1;
      } else {
        skippedNotes += 1;
      }
    } catch {
      const topicMarkdown = renderTopicNote({
        section: topicSection,
        syncedAt,
        editionFetchedAt: saved.savedAt,
        storyPaths: [{ title: saved.title, notePath: storyNotePath }],
      });
      const topicOutcome = await writeNoteIfChanged(
        path.join(vaultPath, `${topicNotePath}.md`),
        topicMarkdown,
      );
      if (topicOutcome === "written") topicNotes = 1;
      else skippedNotes += 1;
    }

    const entityResult = await writeEntityNotes(vaultPath, entityMentions, syncedAt);
    skippedNotes += entityResult.skipped;

    const result: ObsidianSyncResult = {
      ok: true,
      topicNotes,
      storyNotes: storyOutcome === "written" ? 1 : 0,
      entityNotes: entityResult.written,
      skippedNotes,
      vaultPath,
    };
    await recordObsidianSyncSuccess(result);
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Obsidian saved-story sync failed";
    await recordObsidianSyncError(message);
    return {
      ok: false,
      reason: message,
      topicNotes: 0,
      storyNotes: 0,
      entityNotes: 0,
      skippedNotes: 0,
    };
  }
}

function chatFilename(chatTitle: string, chatId: string): string {
  const base = slugifyFilename(chatTitle || "Chat");
  const id = chatNoteId(chatId).replace("brief:chat:", "");
  return `${base} (${id})`;
}

export function renderChatNote(input: ChatObsidianInput & { syncedAt: number }): string {
  const title = input.chatTitle.trim() || "Chat";
  const firstCreated = input.messages[0]?.createdAt;
  const frontmatter = formatFrontmatter({
    id: chatNoteId(input.chatId),
    source: "brief-chat",
    type: "chat",
    title,
    chatId: input.chatId,
    messageCount: input.messages.length,
    ...(typeof firstCreated === "number"
      ? { createdAt: new Date(firstCreated).toISOString() }
      : {}),
    syncedAt: new Date(input.syncedAt).toISOString(),
    tags: ["brief", "brief-chat", "chat"],
  });

  const lines: string[] = [
    frontmatter,
    GENERATED_MARKER,
    "",
    `# ${title}`,
    "",
    `${input.messages.length} messages · chat \`${input.chatId}\``,
    "",
  ];

  for (const message of input.messages) {
    const heading = message.role === "user" ? "User" : "Assistant";
    const when = new Date(message.createdAt).toISOString();
    lines.push(`## ${heading}`, "", `_${when}_`, "", message.text.trim(), "");
  }

  return lines.join("\n");
}

export function normalizeChatObsidianInput(body: unknown): ChatObsidianInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const chatId = typeof value.chatId === "string" ? value.chatId.trim() : "";
  if (!chatId) return null;
  const chatTitle =
    typeof value.chatTitle === "string" && value.chatTitle.trim()
      ? value.chatTitle.trim().slice(0, 120)
      : "Chat";
  if (!Array.isArray(value.messages)) return null;
  const messages: ChatObsidianMessage[] = [];
  for (const item of value.messages) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const text = typeof row.text === "string" ? row.text.trim() : "";
    const role = row.role === "user" || row.role === "assistant" ? row.role : null;
    if (!id || !text || !role) continue;
    const createdAt =
      typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
        ? row.createdAt
        : Date.now();
    messages.push({
      id,
      role,
      text: text.slice(0, 100_000),
      createdAt,
    });
    if (messages.length >= 500) break;
  }
  if (messages.length === 0) return null;
  return { chatId, chatTitle, messages };
}

export async function syncChatToObsidian(
  settings: AppSettings,
  input: ChatObsidianInput,
): Promise<ChatObsidianSyncResult> {
  const sync = resolveObsidianSync(settings);
  if (!sync.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "Obsidian sync is disabled",
    };
  }

  try {
    const vaultPath = path.resolve(sync.vaultPath);
    const syncedAt = Date.now();
    const notePath = path.join(CHATS_DIR, chatFilename(input.chatTitle, input.chatId));
    const markdown = renderChatNote({ ...input, syncedAt });
    const outcome = await writeNoteIfChanged(
      path.join(vaultPath, `${notePath}.md`),
      markdown,
    );
    const result: ChatObsidianSyncResult = {
      ok: true,
      skipped: outcome === "skipped",
      notePath: `${notePath}.md`,
      vaultPath,
      messageCount: input.messages.length,
    };
    await recordObsidianSyncSuccess({
      ok: true,
      topicNotes: 0,
      storyNotes: outcome === "written" ? 1 : 0,
      entityNotes: 0,
      skippedNotes: outcome === "skipped" ? 1 : 0,
      vaultPath,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Obsidian chat sync failed";
    await recordObsidianSyncError(message);
    return { ok: false, reason: message };
  }
}
