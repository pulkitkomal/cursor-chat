import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthRequiredError, api, sendMessage } from "./api";
import { ChatView } from "./components/ChatView";
import { MenuIcon } from "./components/Icons";
import { Login } from "./components/Login";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import type { Chat, ChatMessage, ChatSummary, ModelOption, Settings, StreamEvent } from "./types";

export function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([
    { id: "composer-2.5", displayName: "Composer 2.5" },
  ]);
  const [model, setModel] = useState("composer-2.5");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [bootKey, setBootKey] = useState(0);

  const refreshChats = useCallback(async () => {
    const { chats: next } = await api.chats();
    setChats(next);
    return next;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = await api.session();
        if (session.authRequired && !session.username) {
          setNeedsAuth(true);
          return;
        }
        setUsername(session.username);
        setNeedsAuth(false);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          setNeedsAuth(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load");
        return;
      }

      try {
        const nextSettings = await api.settings();
        setSettings(nextSettings);
        setModel(nextSettings.defaultModel);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          setNeedsAuth(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load settings");
      }

      try {
        const nextChats = await refreshChats();
        if (nextChats[0]) setActiveId(nextChats[0].id);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          setNeedsAuth(true);
          return;
        }
      }

      try {
        const modelResult = await api.models();
        if (modelResult.models.length > 0) setModels(modelResult.models);
      } catch {
        // keep the default model list
      }
    })();
  }, [refreshChats, bootKey]);

  useEffect(() => {
    if (!activeId) {
      setChat(null);
      return;
    }
    void api
      .chat(activeId)
      .then((next) => {
        setChat(next);
        setModel(next.model || settings?.defaultModel || "composer-2.5");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load chat");
      });
  }, [activeId, settings?.defaultModel]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const vv = viewport;
    function syncKeyboard() {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    }
    syncKeyboard();
    vv.addEventListener("resize", syncKeyboard);
    vv.addEventListener("scroll", syncKeyboard);
    return () => {
      vv.removeEventListener("resize", syncKeyboard);
      vv.removeEventListener("scroll", syncKeyboard);
    };
  }, []);

  async function createChat() {
    const next = await api.createChat();
    setChats((current) => [summaryOf(next), ...current.filter((item) => item.id !== next.id)]);
    setActiveId(next.id);
    setChat(next);
    setSettingsOpen(false);
    setSidebarOpen(false);
    setError(null);
  }

  async function selectChat(id: string) {
    setActiveId(id);
    setSettingsOpen(false);
    setSidebarOpen(false);
    setError(null);
  }

  async function removeChat(id: string) {
    await api.deleteChat(id);
    const next = await refreshChats();
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null);
      setChat(next[0] ? await api.chat(next[0].id) : null);
    }
  }

  function applyEvent(event: StreamEvent, current: Chat): Chat {
    const next = { ...current, messages: [...current.messages] };
    const last = next.messages.at(-1);

    switch (event.event) {
      case "user":
        if (last && last.role === "user") {
          next.messages[next.messages.length - 1] = event.data;
        } else if (!next.messages.some((message) => message.id === event.data.id)) {
          next.messages.push(event.data);
        }
        break;
      case "assistant":
        if (!last || last.role !== "assistant" || last.id !== event.data.id) {
          next.messages.push({
            id: event.data.id,
            role: "assistant",
            text: "",
            createdAt: Date.now(),
            tools: [],
          });
        }
        break;
      case "title":
        next.title = event.data.title;
        break;
      case "agent":
        next.agentId = event.data.agentId;
        break;
      case "delta":
        if (last && last.role === "assistant") {
          next.messages[next.messages.length - 1] = {
            ...last,
            text: `${last.text}${event.data.text}`,
          };
        }
        break;
      case "thinking":
        if (last && last.role === "assistant") {
          next.messages[next.messages.length - 1] = {
            ...last,
            thinking: `${last.thinking ?? ""}${event.data.text}`,
          };
        }
        break;
      case "tool":
        if (last && last.role === "assistant") {
          const tools = [...(last.tools ?? [])];
          const index = tools.findIndex((tool) => tool.callId === event.data.callId);
          if (index === -1) tools.push(event.data);
          else tools[index] = { ...tools[index], ...event.data };
          next.messages[next.messages.length - 1] = { ...last, tools };
        }
        break;
      case "done":
        if (event.data.message) {
          const existing = next.messages.findIndex((message) => message.id === event.data.message?.id);
          if (existing >= 0) next.messages[existing] = event.data.message;
          else if (last && last.role === "assistant") {
            next.messages[next.messages.length - 1] = event.data.message;
          }
        }
        break;
      default:
        break;
    }
    return next;
  }

  async function onSend(text: string) {
    setError(null);
    let target = chat;
    if (!target) {
      target = await api.createChat();
      setActiveId(target.id);
      setChat(target);
      setChats((current) => [summaryOf(target!), ...current]);
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: Date.now(),
    };
    const optimistic: Chat = {
      ...target,
      title: target.title === "New chat" ? text.slice(0, 48) : target.title,
      messages: [...target.messages, userMessage],
    };
    setChat(optimistic);
    setStreaming(true);

    try {
      await sendMessage(target.id, text, model, (event) => {
        if (event.event === "error") setError(event.data.message);
        setChat((current) => (current ? applyEvent(event, current) : current));
        if (event.event === "title") {
          setChats((current) =>
            current.map((item) =>
              item.id === target!.id ? { ...item, title: event.data.title } : item,
            ),
          );
        }
      });
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setStreaming(false);
    }
  }

  async function onStop() {
    if (!chat) return;
    await api.cancel(chat.id);
  }

  async function onSaveSettings(next: Partial<Settings> & { apiKey?: string | null }) {
    setSaving(true);
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      if (saved.defaultModel) setModel(saved.defaultModel);
    } finally {
      setSaving(false);
    }
  }

  async function onLogout() {
    await api.logout();
    setNeedsAuth(true);
    setUsername(null);
    setSettings(null);
    setChat(null);
    setChats([]);
  }

  const hasApiKey = settings?.hasApiKey ?? false;
  const main = useMemo(() => {
    if (settingsOpen && settings) {
      return (
        <SettingsPanel
          settings={settings}
          saving={saving}
          onSave={onSaveSettings}
          onDone={() => setSettingsOpen(false)}
        />
      );
    }
    return (
      <ChatView
        chat={chat}
        models={models}
        model={model}
        streaming={streaming}
        error={error}
        hasApiKey={hasApiKey}
        onModelChange={setModel}
        onSend={(text) => void onSend(text)}
        onStop={() => void onStop()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  }, [settingsOpen, settings, saving, chat, models, model, streaming, error, hasApiKey]);

  if (needsAuth) {
    return (
      <Login
        onLoggedIn={() => {
          setNeedsAuth(false);
          setBootKey((key) => key + 1);
        }}
      />
    );
  }

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <button
        type="button"
        className="menu"
        aria-label={sidebarOpen ? "Close sidebar" : "Open chats"}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <MenuIcon width={18} height={18} />
      </button>
      {sidebarOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close chats"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        chats={chats}
        activeId={activeId}
        settingsOpen={settingsOpen}
        onNew={() => void createChat()}
        onSelect={(id) => void selectChat(id)}
        onDelete={(id) => void removeChat(id)}
        username={username}
        onClose={() => setSidebarOpen(false)}
        onLogout={username ? () => void onLogout() : undefined}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
      />
      <main>{main}</main>
    </div>
  );
}

function summaryOf(chat: Chat): ChatSummary {
  const { messages: _messages, ...summary } = chat;
  return summary;
}
