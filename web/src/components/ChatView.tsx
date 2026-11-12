import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CopyIcon, MemoryIcon, ObsidianIcon } from "./Icons";
import { Markdown } from "./Markdown";
import type { Chat, ChatMessage, ModelOption } from "../types";
import { Composer } from "./Composer";
import { ModelSelect } from "./ModelSelect";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";

type Props = {
  chat: Chat | null;
  models: ModelOption[];
  model: string;
  streaming: boolean;
  error?: string | null;
  retryable?: boolean;
  modelsWarning?: string | null;
  hasApiKey: boolean;
  useMemory: boolean;
  useObsidianWorkspace: boolean;
  obsidianEnabled: boolean;
  onModelChange: (model: string) => void;
  onToggleMemory: () => void;
  onToggleObsidianWorkspace: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry?: () => void;
  onOpenSettings: () => void;
};

function TypingIndicator() {
  return (
    <div className="typing" aria-label="Generating" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function MessageView({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const waiting = Boolean(streaming && message.role === "assistant" && !message.text);

  async function copy() {
    await navigator.clipboard.writeText(message.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className={`message ${message.role}${waiting ? " pending" : ""}`}>
      <div className="bubble">
        {message.thinking ? (
          <details className="thinking" open={streaming && !message.text}>
            <summary>Thinking</summary>
            <pre>{message.thinking}</pre>
          </details>
        ) : null}
        {message.tools && message.tools.length > 0 ? (
          <ul className="tools">
            {message.tools.map((tool) => (
              <li key={tool.callId} className={`tool-chip ${tool.status}`}>
                <details>
                  <summary>
                    <span className="dot" />
                    <code>{tool.name}</code>
                    <em>{tool.status}</em>
                  </summary>
                  {tool.args != null ? (
                    <pre>{safeJson(tool.args)}</pre>
                  ) : null}
                  {tool.result != null ? (
                    <pre>{safeJson(tool.result)}</pre>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        ) : null}
        {message.role === "assistant" ? (
          message.text ? <Markdown text={message.text} streaming={streaming} /> : null
        ) : (
          <p className="user-text">{message.text}</p>
        )}
        {waiting ? <TypingIndicator /> : null}
        {message.text && !streaming ? (
          <div className="message-meta">
            <Button variant="ghost" onClick={() => void copy()}>
              <CopyIcon width={13} height={13} />
              {copied ? "Copied" : "Copy"}
            </Button>
            {message.usage ? <span>{message.usage.totalTokens.toLocaleString()} tokens</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const suggestions = [
  "Summarize this workspace in a few sentences.",
  "Help me plan a feature, then list the files you'd touch.",
  "What should I work on next?",
];

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value);
  }
}

export function ChatView({
  chat,
  models,
  model,
  streaming,
  error,
  retryable,
  modelsWarning,
  hasApiKey,
  useMemory,
  useObsidianWorkspace,
  obsidianEnabled,
  onModelChange,
  onToggleMemory,
  onToggleObsidianWorkspace,
  onSend,
  onStop,
  onRetry,
  onOpenSettings,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [obsidianState, setObsidianState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat?.messages, streaming]);

  useEffect(() => {
    setObsidianState("idle");
  }, [chat?.id]);

  const last = chat?.messages.at(-1);
  const empty = !chat || chat.messages.length === 0;
  const waitingForAssistant = streaming && (!last || last.role === "user");
  const totalTokens =
    chat?.messages.reduce((sum, message) => sum + (message.usage?.totalTokens ?? 0), 0) ?? 0;
  const canAddToObsidian =
    Boolean(obsidianEnabled && chat && !streaming) &&
    Boolean(chat?.messages.some((message) => message.text.trim()));

  async function addChatToObsidian() {
    if (!chat || obsidianState === "saving") return;
    setObsidianState("saving");
    try {
      const result = await api.syncChatToObsidian({
        chatId: chat.id,
        chatTitle: chat.title,
        messages: chat.messages
          .filter((message) => message.text.trim())
          .map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
          })),
      });
      if (result.skipped && result.reason) throw new Error(result.reason);
      setObsidianState("saved");
      window.setTimeout(() => setObsidianState("idle"), 1600);
    } catch {
      setObsidianState("error");
      window.setTimeout(() => setObsidianState("idle"), 2200);
    }
  }

  return (
    <section className="chat">
      <div className="chat-top">
        <header className="chat-header glass">
          <h1>{chat?.title ?? "New chat"}</h1>
          <div className="chat-header-meta">
            {totalTokens > 0 ? (
              <span className="token-total" title="Total tokens used in this chat">
                {totalTokens.toLocaleString()} tokens
              </span>
            ) : null}
            {obsidianEnabled ? (
              <>
                <button
                  type="button"
                  className={`memory-toggle ${useObsidianWorkspace ? "on" : ""}`}
                  disabled={!chat || streaming}
                  aria-pressed={useObsidianWorkspace}
                  title={
                    useObsidianWorkspace
                      ? "Vault on — agent cwd is the Obsidian vault (Brief notes readable)"
                      : "Vault off — agent uses the normal workspace"
                  }
                  onClick={onToggleObsidianWorkspace}
                >
                  <ObsidianIcon width={14} height={14} />
                  Vault
                </button>
                <button
                  type="button"
                  className="memory-toggle"
                  disabled={!canAddToObsidian || obsidianState === "saving"}
                  title="Save this whole chat into Obsidian"
                  onClick={() => void addChatToObsidian()}
                >
                  <ObsidianIcon width={14} height={14} />
                  {obsidianState === "saving"
                    ? "Adding…"
                    : obsidianState === "saved"
                      ? "Added"
                      : obsidianState === "error"
                        ? "Failed"
                        : "Add to Obsidian"}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={`memory-toggle ${useMemory ? "on" : ""}`}
              disabled={!chat || streaming}
              aria-pressed={useMemory}
              title={
                useMemory
                  ? "Memory on — Cursor user memories/rules load for this chat"
                  : "Memory off — chat runs without user settingSources"
              }
              onClick={onToggleMemory}
            >
              <MemoryIcon width={14} height={14} />
              Memory
            </button>
            <ModelSelect
              model={model}
              models={models}
              disabled={streaming}
              onChange={onModelChange}
            />
          </div>
        </header>
      </div>
      <div className="transcript" ref={scroller}>
        {empty ? (
          <EmptyState
            title="Ask clearly. Get a brief answer."
            description="History stays on this device. Agents stay attached to each chat."
          >
            {!hasApiKey ? (
              <button type="button" className="banner" onClick={onOpenSettings}>
                Add a Cursor API key in Settings to start talking.
              </button>
            ) : (
              <div className="suggestions">
                {suggestions.map((item) => (
                  <button key={item} type="button" onClick={() => onSend(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            {chat.messages.map((message, index) => {
              const isLive = streaming && index === chat.messages.length - 1 && last?.role === "assistant";
              const blank =
                message.role === "assistant" &&
                !message.text &&
                !message.thinking &&
                !(message.tools && message.tools.length > 0);
              if (blank && !isLive) return null;
              return <MessageView key={message.id} message={message} streaming={isLive} />;
            })}
            {waitingForAssistant ? (
              <article className="message assistant pending">
                <div className="bubble">
                  <TypingIndicator />
                </div>
              </article>
            ) : null}
          </>
        )}
        {modelsWarning ? <p className="warn-line">{modelsWarning}</p> : null}
        {error ? (
          <div className="error-banner rise-in">
            <p className="error-line">{error}</p>
            {retryable && onRetry ? (
              <Button variant="accent" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="chat-bottom">
        <Composer
          streaming={streaming}
          disabled={!hasApiKey}
          totalTokens={totalTokens}
          onSend={onSend}
          onStop={onStop}
        />
      </div>
    </section>
  );
}
