import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AppSettings, ChatRecord, ChatSummary } from "./types.ts";
import { ASD_STE100_SYSTEM_PROMPT } from "./ste100.ts";
import { DEFAULT_OBSIDIAN_VAULT } from "./obsidian.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(root, "data");
const settingsPath = path.join(dataDir, "settings.json");
const chatsDir = path.join(dataDir, "chats");

export const defaultWorkspace =
  process.env.WORKSPACE?.trim() || path.join(dataDir, "workspace");

const defaultSettings = (): AppSettings => ({
  workspace: defaultWorkspace,
  defaultModel: "auto",
  systemPrompt: ASD_STE100_SYSTEM_PROMPT,
  useMemory: false,
  loadUserMcp: false,
  loadProjectMcp: false,
  mcpServers: [],
  obsidianEnabled: false,
  obsidianVault: DEFAULT_OBSIDIAN_VAULT,
  obsidianUseAsWorkspace: false,
});

async function ensureDirs() {
  await mkdir(chatsDir, { recursive: true });
  await mkdir(defaultWorkspace, { recursive: true });
}

async function atomicWrite(file: string, contents: string) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file);
}

export async function readSettings(): Promise<AppSettings> {
  await ensureDirs();
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const defaults = defaultSettings();
    const merged: AppSettings = {
      ...defaults,
      ...parsed,
      mcpServers: parsed.mcpServers ?? [],
      obsidianEnabled:
        typeof parsed.obsidianEnabled === "boolean"
          ? parsed.obsidianEnabled
          : defaults.obsidianEnabled,
      obsidianVault:
        typeof parsed.obsidianVault === "string" && parsed.obsidianVault.trim()
          ? parsed.obsidianVault.trim()
          : defaults.obsidianVault,
      obsidianUseAsWorkspace:
        typeof parsed.obsidianUseAsWorkspace === "boolean"
          ? parsed.obsidianUseAsWorkspace
          : defaults.obsidianUseAsWorkspace,
    };
    if (merged.workspace) {
      try {
        await access(merged.workspace);
      } catch {
        merged.workspace = defaultWorkspace;
      }
    }
    return merged;
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(next: AppSettings): Promise<void> {
  await ensureDirs();
  await atomicWrite(settingsPath, JSON.stringify(next, null, 2));
}

function chatPath(id: string) {
  return path.join(chatsDir, `${id}.json`);
}

export async function listChats(): Promise<ChatSummary[]> {
  await ensureDirs();
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(chatsDir);
  const chats: ChatSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(chatsDir, file), "utf8");
      const chat = JSON.parse(raw) as ChatRecord;
      const { messages: _messages, ...summary } = chat;
      chats.push(summary);
    } catch {
      // skip corrupt files
    }
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readChat(id: string): Promise<ChatRecord | null> {
  await ensureDirs();
  try {
    const raw = await readFile(chatPath(id), "utf8");
    return JSON.parse(raw) as ChatRecord;
  } catch {
    return null;
  }
}

export async function writeChat(chat: ChatRecord): Promise<void> {
  await ensureDirs();
  await atomicWrite(chatPath(chat.id), JSON.stringify(chat, null, 2));
}

export async function deleteChat(id: string): Promise<boolean> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(chatPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function createChat(
  model: string,
  options?: { useMemory?: boolean },
): Promise<ChatRecord> {
  const now = Date.now();
  const chat: ChatRecord = {
    id: randomUUID(),
    title: "New chat",
    model,
    useMemory: options?.useMemory ?? false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await writeChat(chat);
  return chat;
}

export function titleFromPrompt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "New chat";
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed;
}
