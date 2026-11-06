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
import type { AppSettings, ChatMessage, ToolCallRecord } from "./types.ts";
import {
  authEnabled,
  loginHandler,
  logoutHandler,
  requireAuth,
  sessionHandler,
} from "./auth.ts";

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

async function runtimeFromSettings(settings: AppSettings, model: string) {
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
      settingSources: settingSourcesFor(settings),
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

app.get("/api/settings", async (_req, res) => {
  const settings = await readSettings();
  const { source } = resolveApiKey(settings);
  const { apiKey: _apiKey, ...rest } = settings;
  res.json({
    ...rest,
    hasApiKey: source !== "none",
    apiKeySource: source,
  });
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
    mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : current.mcpServers,
  };
  if (body.apiKey === null || body.apiKey === "") {
    delete next.apiKey;
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    next.apiKey = body.apiKey.trim();
  }
  await writeSettings(next);
  await disposeAllAgents();
  const { source } = resolveApiKey(next);
  const { apiKey: _apiKey, ...rest } = next;
  res.json({
    ...rest,
    hasApiKey: source !== "none",
    apiKeySource: source,
  });
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
    res.json({
      models: models.map((model) => ({
        id: model.id,
        displayName:
          "displayName" in model && typeof model.displayName === "string"
            ? model.displayName
            : model.id,
      })),
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
  const chat = await createChat(settings.defaultModel);
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
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    chat.title = req.body.title.trim();
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
  req.on("close", () => {
    closed = true;
  });

  try {
    const runtime = await runtimeFromSettings(settings, model);
    const agent = await acquireAgent({
      chatId: chat.id,
      agentId: chat.agentId,
      options: runtime.options,
    });
    if (!chat.agentId) {
      chat.agentId = agent.agentId;
      await writeChat(chat);
      sendSse(res, "agent", { agentId: agent.agentId });
    }

    const style = settings.systemPrompt?.trim() ?? "";
    const isFirstUserTurn =
      chat.messages.filter((message) => message.role === "user").length === 1;
    const outbound =
      style && isFirstUserTurn
        ? `${style}\n\n---\nUser message:\n${text}`
        : text;

    const run = await agent.send(outbound, {
      model: { id: model },
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

    activeRuns.set(chat.id, {
      chatId: chat.id,
      runId: run.id,
      cancel: async () => {
        if (run.supports("cancel")) await run.cancel();
      },
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
      sendSse(res, "error", { message });
    }

    chat.messages.push(assistantMessage);
    chat.updatedAt = Date.now();
    await writeChat(chat);

    sendSse(res, "done", {
      status: result.status,
      usage: assistantMessage.usage,
      message: assistantMessage,
    });
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
    sendSse(res, "error", {
      message,
      retryable: error instanceof CursorAgentError ? error.isRetryable : false,
    });
    sendSse(res, "done", { status: "error", message: assistantMessage });
  } finally {
    activeRuns.delete(chat.id);
    res.end();
  }
});

if (process.env.NODE_ENV === "production") {
  const webDir = path.join(root, "dist/web");
  app.use(express.static(webDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
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
