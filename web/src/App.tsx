import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthRequiredError, api, sendMessage } from "./api";
import { ChatView } from "./components/ChatView";
import { MenuIcon, PlusIcon } from "./components/Icons";
import { Login } from "./components/Login";
import { SavedPanel } from "./components/SavedPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { TopicsPanel } from "./components/TopicsPanel";
import { UsagePanel } from "./components/UsagePanel";
import { useTheme } from "./hooks/useTheme";
import type { Chat, ChatMessage, ChatSummary, ModelOption, Settings, StreamEvent } from "./types";

type Panel = "chat" | "settings" | "usage" | "topics" | "saved";

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [panel, setPanel] = useState<Panel>("chat");
  const [models, setModels] = useState<ModelOption[]>([{ id: "auto", displayName: "Auto" }]);
  const [model, setModel] = useState("auto");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [modelsWarning, setModelsWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Mobile drawer is mounted only while open/animating — a closed off-screen drawer steals taps on iOS. */
  const [sidebarMounted, setSidebarMounted] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [wideLayout, setWideLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 821px)").matches,
  );
  const [needsAuth, setNeedsAuth] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [bootKey, setBootKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

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
        const [nextSettings, nextChats] = await Promise.all([
          api.settings(),
          refreshChats(),
        ]);
        setSettings(nextSettings);
        setModel(nextSettings.defaultModel);
        if (nextChats[0]) setActiveId(nextChats[0].id);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          setNeedsAuth(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load");
      }

      // Models are not needed to paint the chat list; fetch after first paint.
      void api
        .models()
        .then((modelResult) => {
          if (modelResult.models.length > 0) setModels(modelResult.models);
          setModelsWarning(modelResult.warning ?? null);
        })
        .catch(() => {
          // keep the default model list
        });
    })();
  }, [refreshChats, bootKey]);

  useEffect(() => {
    if (!activeId || panel !== "chat") {
      if (!activeId) setChat(null);
      return;
    }
    void api
      .chat(activeId)
      .then((next) => {
        setChat(next);
        setModel(next.model || settings?.defaultModel || "auto");
      })
      .catch((err: unknown) => {
        if (err instanceof AuthRequiredError) {
          setNeedsAuth(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load chat");
      });
  }, [activeId, settings?.defaultModel, panel]);

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
    const mq = window.matchMedia("(min-width: 821px)");
    const sync = () => setWideLayout(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (wideLayout) {
      setSidebarMounted(true);
      setSidebarVisible(true);
      return;
    }
    if (sidebarOpen) {
      setSidebarMounted(true);
      let inner = 0;
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setSidebarVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(outer);
        window.cancelAnimationFrame(inner);
      };
    }
    setSidebarVisible(false);
    const t = window.setTimeout(() => setSidebarMounted(false), 300);
    return () => window.clearTimeout(t);
  }, [sidebarOpen, wideLayout]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const vv = viewport;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    function syncKeyboard() {
      // iOS PWA often reports a small occlusion from the home indicator; that is
      // already handled by --safe-b. Only lift for a real keyboard.
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const safeBottom = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      const inset = occluded > safeBottom + 40 ? occluded : 0;
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    }
    function syncSafeArea() {
      const styles = getComputedStyle(probe);
      const top = Number.parseFloat(styles.paddingTop) || 0;
      const bottom = Number.parseFloat(styles.paddingBottom) || 0;
      // Pin resolved px values — env() can stay 0 on iOS PWA cold start until a reflow
      if (top > 0) document.documentElement.style.setProperty("--safe-t", `${top}px`);
      if (bottom > 0) document.documentElement.style.setProperty("--safe-b", `${bottom}px`);
    }
    function syncInsets() {
      syncSafeArea();
      syncKeyboard();
    }
    syncInsets();
    const raf = window.requestAnimationFrame(() => syncInsets());
    const t1 = window.setTimeout(syncInsets, 50);
    const t2 = window.setTimeout(syncInsets, 300);
    vv.addEventListener("resize", syncInsets);
    vv.addEventListener("scroll", syncInsets);
    window.addEventListener("pageshow", syncInsets);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      vv.removeEventListener("resize", syncInsets);
      vv.removeEventListener("scroll", syncInsets);
      window.removeEventListener("pageshow", syncInsets);
      probe.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function createChat() {
    const next = await api.createChat();
    setChats((current) => [summaryOf(next), ...current.filter((item) => item.id !== next.id)]);
    setActiveId(next.id);
    setChat(next);
    setPanel("chat");
    setSidebarOpen(false);
    setError(null);
    setRetryable(false);
  }

  async function selectChat(id: string) {
    setActiveId(id);
    setPanel("chat");
    setSidebarOpen(false);
    setError(null);
    setRetryable(false);
  }

  async function removeChat(id: string) {
    await api.deleteChat(id);
    const next = await refreshChats();
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null);
      setChat(next[0] ? await api.chat(next[0].id) : null);
    }
  }

  async function renameChat(id: string, title: string) {
    const updated = await api.renameChat(id, title);
    setChats((current) =>
      current.map((item) => (item.id === id ? { ...item, title: updated.title } : item)),
    );
    setChat((current) => (current?.id === id ? { ...current, title: updated.title } : current));
  }

  async function toggleMemory() {
    if (!chat) return;
    const next = !(chat.useMemory ?? settings?.useMemory ?? false);
    try {
      const updated = await api.setChatMemory(chat.id, next);
      setChat(updated);
      setChats((current) =>
        current.map((item) =>
          item.id === updated.id ? { ...item, useMemory: updated.useMemory } : item,
        ),
      );
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setNeedsAuth(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to update memory");
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
    setRetryable(false);
    setLastPrompt(text);
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
    setPanel("chat");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await sendMessage(
        target.id,
        text,
        model,
        (event) => {
          if (event.event === "error") {
            setError(event.data.message);
            setRetryable(Boolean(event.data.retryable));
          }
          setChat((current) => (current ? applyEvent(event, current) : current));
          if (event.event === "title") {
            setChats((current) =>
              current.map((item) =>
                item.id === target!.id ? { ...item, title: event.data.title } : item,
              ),
            );
          }
        },
        controller.signal,
      );
      await refreshChats();
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setNeedsAuth(true);
        return;
      }
      if ((err as Error)?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Send failed");
      setRetryable(true);
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function onStop() {
    abortRef.current?.abort();
    if (!chat) return;
    await api.cancel(chat.id);
  }

  async function onSaveSettings(
    next: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null },
  ) {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      if (saved.defaultModel) setModel(saved.defaultModel);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setNeedsAuth(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to save settings");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function onLogout() {
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      await api.logout();
    } catch {
      // Cookie may already be gone; still clear local session UI.
    } finally {
      setNeedsAuth(true);
      setUsername(null);
      setSettings(null);
      setChat(null);
      setChats([]);
      setActiveId(null);
      setPanel("chat");
      setError(null);
      setStreaming(false);
    }
  }

  const hasApiKey = settings?.hasApiKey ?? false;
  const main = useMemo(() => {
    if (panel === "settings" && settings) {
      return (
        <SettingsPanel
          settings={settings}
          saving={saving}
          onSave={onSaveSettings}
          onDone={() => setPanel("chat")}
        />
      );
    }
    if (panel === "usage") {
      return (
        <UsagePanel
          onDone={() => setPanel("chat")}
          onOpenSettings={() => setPanel("settings")}
        />
      );
    }
    if (panel === "topics") {
      return (
        <TopicsPanel
          hasApiKey={hasApiKey}
          onDone={() => setPanel("chat")}
          onOpenSettings={() => setPanel("settings")}
        />
      );
    }
    if (panel === "saved") {
      return <SavedPanel onDone={() => setPanel("chat")} />;
    }
    return (
      <ChatView
        chat={chat}
        models={models}
        model={model}
        streaming={streaming}
        error={error}
        retryable={retryable}
        modelsWarning={modelsWarning}
        hasApiKey={hasApiKey}
        useMemory={chat?.useMemory ?? settings?.useMemory ?? false}
        obsidianEnabled={Boolean(settings?.obsidianEnabled)}
        onModelChange={setModel}
        onToggleMemory={() => void toggleMemory()}
        onSend={(text) => void onSend(text)}
        onStop={() => void onStop()}
        onRetry={() => {
          if (lastPrompt) void onSend(lastPrompt);
        }}
        onOpenSettings={() => setPanel("settings")}
      />
    );
  }, [
    panel,
    settings,
    saving,
    chat,
    models,
    model,
    streaming,
    error,
    retryable,
    modelsWarning,
    hasApiKey,
    lastPrompt,
  ]);

  if (needsAuth) {
    return (
      <Login
        theme={theme}
        onToggleTheme={toggleTheme}
        onLoggedIn={() => {
          setNeedsAuth(false);
          setBootKey((key) => key + 1);
        }}
      />
    );
  }

  const drawerOpen = wideLayout || sidebarVisible;

  return (
    <div className={`app ${drawerOpen ? "sidebar-open" : ""}`}>
      <div className="ambient" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <button
        type="button"
        className="menu"
        aria-label={sidebarOpen ? "Close sidebar" : "Open chats"}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <MenuIcon width={16} height={16} />
      </button>
      <button
        type="button"
        className="new-chat-fab"
        aria-label="New chat"
        onClick={() => void createChat()}
      >
        <PlusIcon width={16} height={16} />
      </button>
      {!wideLayout && sidebarVisible ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close chats"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      {wideLayout || sidebarMounted ? (
        <Sidebar
          chats={chats}
          activeId={activeId}
          panel={panel}
          onNew={() => void createChat()}
          onSelect={(id) => void selectChat(id)}
          onDelete={(id) => void removeChat(id)}
          onRename={(id, title) => void renameChat(id, title)}
          username={username}
          onClose={wideLayout ? undefined : () => setSidebarOpen(false)}
          onLogout={username ? () => void onLogout() : undefined}
          onOpenSettings={() => {
            setPanel("settings");
            setSidebarOpen(false);
          }}
          onOpenUsage={() => {
            setPanel("usage");
            setSidebarOpen(false);
          }}
          onOpenTopics={() => {
            setPanel("topics");
            setSidebarOpen(false);
          }}
          onOpenSaved={() => {
            setPanel("saved");
            setSidebarOpen(false);
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      ) : null}
      <main className="panel-swap">{main}</main>
    </div>
  );
}

function summaryOf(chat: Chat): ChatSummary {
  const { messages: _messages, ...summary } = chat;
  return summary;
}
