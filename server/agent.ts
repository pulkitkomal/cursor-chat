import { Agent, CursorAgentError, type SDKAgent } from "@cursor/sdk";
import type { AppSettings, TokenUsage, ToolCallRecord } from "./types.ts";

type CachedAgent = {
  agent: SDKAgent;
  chatId: string;
  fingerprint: string;
  lastUsed: number;
};

const cache = new Map<string, CachedAgent>();
const TTL_MS = 10 * 60 * 1000;

export type AgentRuntimeOptions = {
  apiKey: string;
  workspace: string;
  model: string;
  systemPrompt?: string;
  settingSources: Array<"project" | "user" | "plugins" | "team" | "mdm" | "all">;
};

export function resolveApiKey(settings: AppSettings): {
  apiKey?: string;
  source: "settings" | "env" | "none";
} {
  const fromSettings = settings.apiKey?.trim();
  if (fromSettings) return { apiKey: fromSettings, source: "settings" };
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };
  return { source: "none" };
}

export function settingSourcesFor(
  settings: AppSettings,
  overrides?: { useMemory?: boolean },
): AgentRuntimeOptions["settingSources"] {
  const useMemory = overrides?.useMemory ?? settings.useMemory;
  return useMemory ? ["user"] : [];
}

function fingerprint(options: AgentRuntimeOptions): string {
  return JSON.stringify({
    workspace: options.workspace,
    model: options.model,
    systemPrompt: options.systemPrompt ?? "",
    settingSources: options.settingSources,
  });
}

function evictExpired(now = Date.now()) {
  for (const [chatId, entry] of cache) {
    if (now - entry.lastUsed > TTL_MS) {
      entry.agent.close();
      cache.delete(chatId);
    }
  }
}

setInterval(() => evictExpired(), 60_000).unref();

export async function disposeChatAgent(chatId: string) {
  const entry = cache.get(chatId);
  if (!entry) return;
  cache.delete(chatId);
  try {
    await entry.agent[Symbol.asyncDispose]();
  } catch {
    entry.agent.close();
  }
}

export async function disposeAllAgents() {
  const ids = [...cache.keys()];
  await Promise.all(ids.map((id) => disposeChatAgent(id)));
}

export async function acquireAgent(input: {
  chatId: string;
  agentId?: string;
  options: AgentRuntimeOptions;
}): Promise<SDKAgent> {
  evictExpired();
  const mark = fingerprint(input.options);
  const existing = cache.get(input.chatId);
  if (existing && existing.fingerprint === mark) {
    existing.lastUsed = Date.now();
    return existing.agent;
  }
  if (existing) {
    await disposeChatAgent(input.chatId);
  }

  const modelId = input.options.model === "auto" ? "default" : input.options.model;
  const createOptions = {
    apiKey: input.options.apiKey,
    model: { id: modelId },
    local: {
      cwd: input.options.workspace,
      ...(input.options.settingSources.length > 0
        ? { settingSources: input.options.settingSources }
        : {}),
    },
    // Do not pass systemPrompt to the SDK. Many accounts reject custom
    // system prompts; reply style is applied as a message prefix instead.
  } as Parameters<typeof Agent.create>[0];

  const agent = input.agentId
    ? await Agent.resume(input.agentId, createOptions)
    : await Agent.create(createOptions);

  cache.set(input.chatId, {
    agent,
    chatId: input.chatId,
    fingerprint: mark,
    lastUsed: Date.now(),
  });
  return agent;
}

export function toolName(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object") return "tool";
  const value = toolCall as Record<string, unknown>;
  if (typeof value.name === "string") return value.name;
  if (typeof value.type === "string") return value.type;
  if (value.tool && typeof value.tool === "object") {
    const nested = value.tool as Record<string, unknown>;
    if (typeof nested.name === "string") return nested.name;
    if (typeof nested.type === "string") return nested.type;
  }
  return "tool";
}

export function extractMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const value = message as Record<string, unknown>;
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const item = block as Record<string, unknown>;
        return typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }
  if (value.message) return extractMessageText(value.message);
  return "";
}

export function asTokenUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as Record<string, unknown>;
  if (typeof value.totalTokens !== "number") return undefined;
  return {
    inputTokens: Number(value.inputTokens ?? 0),
    outputTokens: Number(value.outputTokens ?? 0),
    cacheReadTokens: Number(value.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(value.cacheWriteTokens ?? 0),
    totalTokens: Number(value.totalTokens ?? 0),
    ...(typeof value.reasoningTokens === "number"
      ? { reasoningTokens: value.reasoningTokens }
      : {}),
  };
}

export function upsertTool(
  tools: ToolCallRecord[],
  next: ToolCallRecord,
): ToolCallRecord[] {
  const index = tools.findIndex((tool) => tool.callId === next.callId);
  if (index === -1) return [...tools, next];
  const copy = [...tools];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export { Agent, CursorAgentError };
