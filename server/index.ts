import "dotenv/config";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Cursor } from "@cursor/sdk";
import {
  Agent,
  CursorAgentError,
  acquireAgent,
  asTokenUsage,
  disposeAllAgents,
  disposeChatAgent,
  resolveApiKey,
  settingSourcesFor,
  toSdkMcpServers,
  toolName,
  upsertTool,
} from "./agent.ts";
import {
  createChat,
  deleteChat,
  listChats,
  readChat,
  readSettings,
  titleFromPrompt,
  writeChat,
  writeSettings,
} from "./store.ts";
import type { AppSettings, ChatMessage, McpServerEntry, ToolCallRecord } from "./types.ts";
import {
  authEnabled,
  loginHandler,
  logoutHandler,
  requireAuth,
  sessionHandler,
} from "./auth.ts";
import { collectUsageStats } from "./usage.ts";
import {
  beginTopicsRefresh,
  normalizeInterests,
  readTopicsState,
  readTopicsStateWithRefresh,
  writeTopicsState,
} from "./topics.ts";
import {
  deleteSavedStory,
  normalizeSavedInput,
  readSavedStories,
  saveStory,
} from "./saved.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3847);
const host = process.env.HOST ?? "127.0.0.1";

type ActiveRun = {
  chatId: string;
  runId: string;
  cancel: () => Promise<void>;
};

const activeRuns = new Map<string, ActiveRun>();

function sendSse(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function runtimeFromSettings(
  settings: AppSettings,
  model: string,
  overrides?: { useMemory?: boolean },
) {
  const { apiKey, source } = resolveApiKey(settings);
  if (!apiKey) {
    const error = new Error(
      "Missing Cursor API key. Add one in Settings or set CURSOR_API_KEY.",
    );
    (error as Error & { status: number }).status = 401;
    throw error;
  }
  await mkdir(settings.workspace, { recursive: true });
  return {
    apiKey,
    source,
    options: {
      apiKey,
      workspace: settings.workspace,
      model,
      systemPrompt: settings.systemPrompt,
      mcpServers: toSdkMcpServers(settings.mcpServers),
      settingSources: settingSourcesFor(settings, overrides),
    },
  };
}

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "4mb" }));
app.use(requireAuth);

app.get("/api/health", async (_req, res) => {
  const settings = await readSettings();
  const { source } = resolveApiKey(settings);
  res.json({ ok: true, apiKeySource: source, hasApiKey: source !== "none", authRequired: authEnabled() });
});

app.get("/api/session", sessionHandler);
app.post("/api/login", loginHandler);
app.post("/api/logout", logoutHandler);

function publicSettings(settings: AppSettings) {
  const { source } = resolveApiKey(settings);
  const { apiKey: _apiKey, sessionToken: _sessionToken, ...rest } = settings;
  return {
    ...rest,
    hasApiKey: source !== "none",
    apiKeySource: source,
    hasSessionToken: Boolean(
      settings.sessionToken?.trim() ||
        process.env.CURSOR_SESSION_TOKEN?.trim() ||
        process.env.CURSOR_SESSION_COOKIE?.trim(),
    ),
  };
}

app.get("/api/settings", async (_req, res) => {
  const settings = await readSettings();
  res.json(publicSettings(settings));
});

app.put("/api/settings", async (req, res) => {
  const current = await readSettings();
  const body = req.body as Partial<AppSettings> & { apiKey?: string | null };
  const next: AppSettings = {
    ...current,
    workspace:
      typeof body.workspace === "string" && body.workspace.trim()
        ? body.workspace.trim()
        : current.workspace,
    defaultModel:
      typeof body.defaultModel === "string" && body.defaultModel.trim()
        ? body.defaultModel.trim()
        : current.defaultModel,
    systemPrompt:
      typeof body.systemPrompt === "string" ? body.systemPrompt : current.systemPrompt,
    loadUserMcp:
      typeof body.loadUserMcp === "boolean" ? body.loadUserMcp : current.loadUserMcp,
    loadProjectMcp:
      typeof body.loadProjectMcp === "boolean"
        ? body.loadProjectMcp
        : current.loadProjectMcp,
    useMemory: typeof body.useMemory === "boolean" ? body.useMemory : current.useMemory,
    mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : current.mcpServers,
  };
  if (body.apiKey === null || body.apiKey === "") {
    delete next.apiKey;
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    next.apiKey = body.apiKey.trim();
  }
  if (body.sessionToken === null || body.sessionToken === "") {
    delete next.sessionToken;
  } else if (typeof body.sessionToken === "string" && body.sessionToken.trim()) {
    next.sessionToken = body.sessionToken.trim();
  }
  await writeSettings(next);
  await disposeAllAgents();
  res.json(publicSettings(next));
});

app.get("/api/usage", async (_req, res) => {
  try {
    const settings = await readSettings();
    res.json(await collectUsageStats(settings));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load usage",
    });
  }
});

app.post("/api/mcp/test", async (req, res) => {
  const entry = req.body as McpServerEntry;
  if (!entry?.name?.trim()) {
    res.status(400).json({ ok: false, error: "Server name is required" });
    return;
  }
  try {
    if (entry.type === "http") {
      if (!entry.url?.trim()) {
        res.status(400).json({ ok: false, error: "URL is required" });
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(entry.url, {
        method: "GET",
        headers: entry.headers,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      res.json({
        ok: response.ok || response.status === 405 || response.status === 406,
        status: response.status,
        message: response.ok
          ? `Reached ${entry.url}`
          : `HTTP ${response.status} from ${entry.url}`,
      });
      return;
    }
    if (!entry.command?.trim()) {
      res.status(400).json({ ok: false, error: "Command is required" });
      return;
    }
    const { spawn } = await import("node:child_process");
    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      let settled = false;
      const finish = (value: { ok: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const child = spawn(entry.command, entry.args ?? [], {
        env: { ...process.env, ...(entry.env ?? {}) },
        cwd: entry.cwd || undefined,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ ok: true, message: `Started ${entry.command} (timed probe)` });
      }, 1500);
      child.on("error", (error) => {
        clearTimeout(timer);
        finish({ ok: false, message: error.message });
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 || code === null) {
          finish({ ok: true, message: `Command ${entry.command} exited cleanly` });
        } else {
          finish({ ok: false, message: `Command exited with code ${code}` });
        }
      });
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "MCP test failed",
    });
  }
});

app.get("/api/topics", async (_req, res) => {
  res.json(await readTopicsStateWithRefresh());
});

app.put("/api/topics/interests", async (req, res) => {
  const interests = normalizeInterests(req.body?.interests);
  const current = await readTopicsState();
  const edition =
    interests.length === 0 || !current.edition
      ? null
      : {
          ...current.edition,
          sections: current.edition.sections.filter((section) =>
            interests.some((topic) => topic.toLowerCase() === section.topic.toLowerCase()),
          ),
        };
  const next = {
    interests,
    edition: edition && edition.sections.length > 0 ? edition : null,
    lifetimeUsage: current.lifetimeUsage,
    refreshCount: current.refreshCount ?? 0,
  };
  await writeTopicsState(next);
  res.json(await readTopicsStateWithRefresh());
});

app.post("/api/topics/refresh", async (req, res) => {
  try {
    const settings = await readSettings();
    const { apiKey } = resolveApiKey(settings);
    if (!apiKey) {
      res.status(401).json({
        error: "Missing Cursor API key. Add one in Settings or set CURSOR_API_KEY.",
      });
      return;
    }
    await mkdir(settings.workspace, { recursive: true });
    const current = await readTopicsState();
    const bodyInterests = normalizeInterests(req.body?.interests);
    const interests = bodyInterests.length > 0 ? bodyInterests : current.interests;
    if (interests.length === 0) {
      res.status(400).json({ error: "Add at least one topic before refreshing." });
      return;
    }
    // Run in the background — Cloudflare 524s if this stays open past ~100s.
    beginTopicsRefresh({
      interests,
      apiKey,
      workspace: settings.workspace,
      model: settings.defaultModel,
    });
    res.status(202).json(await readTopicsStateWithRefresh());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to refresh topics",
    });
  }
});

app.get("/api/saved", async (_req, res) => {
  res.json({ items: await readSavedStories() });
});

app.post("/api/saved", async (req, res) => {
  const input = normalizeSavedInput(req.body);
  if (!input) {
    res.status(400).json({ error: "topic, title, and summary are required" });
    return;
  }
  const { item, created } = await saveStory(input);
  res.status(created ? 201 : 200).json({ item, created });
});

app.delete("/api/saved/:id", async (req, res) => {
  const removed = await deleteSavedStory(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Saved story not found" });
    return;
  }
  res.status(204).end();
});

app.get("/api/models", async (_req, res) => {
  try {
    const settings = await readSettings();
    const { apiKey } = resolveApiKey(settings);
    if (!apiKey) {
      res.json({
        models: [{ id: "auto", displayName: "Auto" }],
      });
      return;
    }
    const models = await Cursor.models.list({ apiKey });
    const mapped = models.map((model) => {
      const id = model.id === "default" ? "auto" : model.id;
      const displayName =
        "displayName" in model && typeof model.displayName === "string"
          ? model.displayName
          : id === "auto"
            ? "Auto"
            : model.id;
      return { id, displayName };
    });
    const hasAuto = mapped.some((model) => model.id === "auto");
    res.json({
      models: hasAuto ? mapped : [{ id: "auto", displayName: "Auto" }, ...mapped],
    });
  } catch (error) {
    res.json({
      models: [
        { id: "auto", displayName: "Auto" },
        { id: "composer-2.5", displayName: "Composer 2.5" },
      ],
      warning: error instanceof Error ? error.message : "Could not list models",
    });
  }
});

app.get("/api/chats", async (_req, res) => {
  res.json({ chats: await listChats() });
});

app.post("/api/chats", async (_req, res) => {
  const settings = await readSettings();
  const chat = await createChat(settings.defaultModel, { useMemory: settings.useMemory });
  res.status(201).json(chat);
});

app.get("/api/chats/:id", async (req, res) => {
  const chat = await readChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  res.json(chat);
});

app.patch("/api/chats/:id", async (req, res) => {
  const chat = await readChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  let changed = false;
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    chat.title = req.body.title.trim();
    changed = true;
  }
  if (typeof req.body?.useMemory === "boolean") {
    chat.useMemory = req.body.useMemory;
    changed = true;
    await disposeChatAgent(chat.id);
  }
  if (changed) {
    chat.updatedAt = Date.now();
    await writeChat(chat);
  }
  res.json(chat);
});

app.delete("/api/chats/:id", async (req, res) => {
  const chat = await readChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  activeRuns.delete(chat.id);
  await disposeChatAgent(chat.id);
  if (chat.agentId) {
    try {
      await Agent.delete(chat.agentId, { cwd: (await readSettings()).workspace });
    } catch {
      // local store may already be gone
    }
  }
  await deleteChat(chat.id);
  res.status(204).end();
});

app.post("/api/chats/:id/cancel", async (req, res) => {
  const active = activeRuns.get(req.params.id);
  if (active) {
    try {
      await active.cancel();
    } catch {
      // already finished
    }
  }
  res.json({ ok: true });
});

app.post("/api/chats/:id/messages", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Message text is required" });
    return;
  }

  const chat = await readChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }

  const settings = await readSettings();
  const model =
    typeof req.body?.model === "string" && req.body.model.trim()
      ? req.body.model.trim()
      : chat.model || settings.defaultModel;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    createdAt: Date.now(),
  };
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: "",
    createdAt: Date.now(),
    tools: [],
  };

  chat.messages.push(userMessage);
  if (chat.title === "New chat") chat.title = titleFromPrompt(text);
  chat.model = model;
  chat.updatedAt = Date.now();
  await writeChat(chat);

  sendSse(res, "user", userMessage);
  sendSse(res, "assistant", { id: assistantMessage.id });
  if (chat.title !== "New chat") sendSse(res, "title", { title: chat.title });

  let closed = false;
  let activeCancel: (() => Promise<void>) | null = null;
  req.on("close", () => {
    closed = true;
    if (activeCancel) {
      void activeCancel().catch(() => undefined);
    }
  });

  try {
    const runtime = await runtimeFromSettings(settings, model, {
      useMemory: chat.useMemory ?? settings.useMemory,
    });
    const agent = await acquireAgent({
      chatId: chat.id,
      agentId: chat.agentId,
      options: runtime.options,
    });
    if (!chat.agentId) {
      chat.agentId = agent.agentId;
      await writeChat(chat);
      if (!closed) sendSse(res, "agent", { agentId: agent.agentId });
    }

    if (closed) {
      activeRuns.delete(chat.id);
      res.end();
      return;
    }

    const style = settings.systemPrompt?.trim() ?? "";
    const isFirstUserTurn =
      chat.messages.filter((message) => message.role === "user").length === 1;
    const outbound =
      style && isFirstUserTurn
        ? `${style}\n\n---\nUser message:\n${text}`
        : text;

    const run = await agent.send(outbound, {
      model: { id: model === "auto" ? "default" : model },
      local: { force: true },
      onDelta: ({ update }) => {
        if (closed) return;
        if (update.type === "text-delta") {
          assistantMessage.text += update.text;
          sendSse(res, "delta", { text: update.text });
        } else if (update.type === "thinking-delta") {
          assistantMessage.thinking = `${assistantMessage.thinking ?? ""}${update.text}`;
          sendSse(res, "thinking", { text: update.text });
        } else if (update.type === "tool-call-started") {
          const record: ToolCallRecord = {
            callId: update.callId,
            name: toolName(update.toolCall),
            status: "running",
            args: update.toolCall,
          };
          assistantMessage.tools = upsertTool(assistantMessage.tools ?? [], record);
          sendSse(res, "tool", record);
        } else if (update.type === "tool-call-completed") {
          const record: ToolCallRecord = {
            callId: update.callId,
            name: toolName(update.toolCall),
            status: "completed",
            result: update.toolCall,
          };
          assistantMessage.tools = upsertTool(assistantMessage.tools ?? [], record);
          sendSse(res, "tool", record);
        }
      },
    });

    activeCancel = async () => {
      if (run.supports("cancel")) await run.cancel();
    };
    activeRuns.set(chat.id, {
      chatId: chat.id,
      runId: run.id,
      cancel: activeCancel,
    });

    if (!closed) {
      sendSse(res, "run", { runId: run.id, requestId: run.requestId, agentId: agent.agentId });
    }

    const result = await run.wait();
    assistantMessage.usage = asTokenUsage(result.usage);
    if (!assistantMessage.text && result.result) {
      assistantMessage.text = result.result;
    }
    if (result.status === "error") {
      const message = result.error?.message ?? "The run failed.";
      if (!assistantMessage.text) assistantMessage.text = message;
      if (!closed) sendSse(res, "error", { message });
    }

    chat.messages.push(assistantMessage);
    chat.updatedAt = Date.now();
    await writeChat(chat);

    if (!closed) {
      sendSse(res, "done", {
        status: result.status,
        usage: assistantMessage.usage,
        message: assistantMessage,
      });
    }
  } catch (error) {
    const message =
      error instanceof CursorAgentError
        ? `Could not start the agent: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown error";
    if (!assistantMessage.text) assistantMessage.text = message;
    chat.messages.push(assistantMessage);
    chat.updatedAt = Date.now();
    await writeChat(chat);
    if (!closed) {
      sendSse(res, "error", {
        message,
        retryable: error instanceof CursorAgentError ? error.isRetryable : false,
      });
      sendSse(res, "done", { status: "error", message: assistantMessage });
    }
  } finally {
    activeRuns.delete(chat.id);
    if (!closed) res.end();
  }
});

if (process.env.NODE_ENV === "production") {
  const webDir = path.join(root, "dist/web");
  app.use(
    express.static(webDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith(".webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDir, "index.html"));
  });
}

const server = app.listen(port, host, () => {
  console.log(`cursor-chat API on http://${host}:${port}`);
});

async function shutdown() {
  await disposeAllAgents();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
