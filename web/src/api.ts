import type {
  Chat,
  ChatSummary,
  ModelOption,
  SavedStory,
  Settings,
  ObsidianSyncStatus,
  StreamEvent,
  TopicStory,
  TopicsState,
  UsageStats,
} from "./types";

export class AuthRequiredError extends Error {
  code = "AUTH_REQUIRED" as const;
  constructor(message = "Authentication required") {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    if (path === "/api/login") {
      throw new Error(
        typeof body.error === "string" ? body.error : "Invalid username or password",
      );
    }
    throw new AuthRequiredError();
  }
  // 202 Accepted — background jobs (e.g. topics refresh) return immediately
  if (!response.ok && response.status !== 202) {
    throw new Error(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

export const api = {
  session: () =>
    request<{ ok: boolean; authRequired?: boolean; username: string | null }>("/api/session"),
  login: (username: string, password: string) =>
    request<{ ok: boolean; username?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/logout", {
      method: "POST",
      body: "{}",
    }),
  health: () =>
    request<{
      ok: boolean;
      apiKeySource: Settings["apiKeySource"];
      hasApiKey?: boolean;
      authRequired?: boolean;
    }>("/api/health"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (
    body: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null },
  ) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  models: () => request<{ models: ModelOption[]; warning?: string }>("/api/models"),
  usage: () => request<UsageStats>("/api/usage"),
  topics: () => request<TopicsState>("/api/topics"),
  saveTopicInterests: (interests: string[]) =>
    request<TopicsState>("/api/topics/interests", {
      method: "PUT",
      body: JSON.stringify({ interests }),
    }),
  refreshTopics: (interests?: string[]) =>
    request<TopicsState>("/api/topics/refresh", {
      method: "POST",
      body: JSON.stringify(interests ? { interests } : {}),
    }),
  obsidianStatus: () => request<ObsidianSyncStatus>("/api/obsidian/status"),
  syncChatToObsidian: (body: {
    chatId: string;
    chatTitle: string;
    messages: {
      id: string;
      role: "user" | "assistant";
      text: string;
      createdAt: number;
    }[];
  }) =>
    request<{
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      notePath?: string;
      vaultPath?: string;
      messageCount?: number;
    }>("/api/obsidian/sync-chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  syncTopicsToObsidian: () =>
    request<{
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      topicNotes: number;
      storyNotes: number;
      entityNotes: number;
      skippedNotes: number;
      vaultPath?: string;
      status?: ObsidianSyncStatus;
    }>("/api/obsidian/sync-topics", {
      method: "POST",
      body: "{}",
    }),
  saved: () => request<{ items: SavedStory[] }>("/api/saved"),
  saveStory: (story: TopicStory & { topic: string }) =>
    request<{ item: SavedStory; created: boolean }>("/api/saved", {
      method: "POST",
      body: JSON.stringify(story),
    }),
  unsaveStory: (id: string) => request<void>(`/api/saved/${id}`, { method: "DELETE" }),
  chats: () => request<{ chats: ChatSummary[] }>("/api/chats"),
  createChat: () => request<Chat>("/api/chats", { method: "POST" }),
  chat: (id: string) => request<Chat>(`/api/chats/${id}`),
  renameChat: (id: string, title: string) =>
    request<Chat>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  setChatMemory: (id: string, useMemory: boolean) =>
    request<Chat>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ useMemory }) }),
  setChatObsidianWorkspace: (id: string, useObsidianWorkspace: boolean) =>
    request<Chat>(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ useObsidianWorkspace }),
    }),
  deleteChat: (id: string) => request<void>(`/api/chats/${id}`, { method: "DELETE" }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/api/chats/${id}/cancel`, { method: "POST" }),
};

export async function sendMessage(
  chatId: string,
  text: string,
  model: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "Failed to send");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSse(buffer, onEvent);
  }
  if (buffer.trim()) consumeSse(`${buffer}\n\n`, onEvent);
}

function consumeSse(buffer: string, onEvent: (event: StreamEvent) => void): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    try {
      onEvent({ event, data: JSON.parse(dataLines.join("\n")) } as StreamEvent);
    } catch {
      // ignore malformed chunks
    }
  }
  return rest;
}
