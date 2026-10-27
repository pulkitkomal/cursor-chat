import { useEffect, useRef, useState } from "react";
import { CopyIcon, SparkIcon } from "./Icons";
import { Markdown } from "./Markdown";
import type { Chat, ChatMessage, ModelOption } from "../types";
import { Composer } from "./Composer";
import { ModelSelect } from "./ModelSelect";

type Props = {
  chat: Chat | null;
  models: ModelOption[];
  model: string;
  streaming: boolean;
  error?: string | null;
  hasApiKey: boolean;
  onModelChange: (model: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
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
              <li key={tool.callId} className={tool.status}>
                <span className="dot" />
                <code>{tool.name}</code>
                <em>{tool.status}</em>
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
            <button type="button" className="ghost" onClick={() => void copy()}>
              <CopyIcon width={14} height={14} />
              {copied ? "Copied" : "Copy"}
            </button>
            {message.usage ? <span>{message.usage.totalTokens.toLocaleString()} tokens</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const suggestions = [
  "What can you do with the MCP tools I configured?",
  "Summarize this workspace in a few sentences.",
  "Help me plan a feature, then list the files you'd touch.",
];

export function ChatView({
  chat,
  models,
  model,
  streaming,
  error,
  hasApiKey,
  onModelChange,
  onSend,
  onStop,
  onOpenSettings,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat?.messages, streaming]);

  const last = chat?.messages.at(-1);
  const empty = !chat || chat.messages.length === 0;
  const waitingForAssistant = streaming && (!last || last.role === "user");

  return (
    <section className="chat">
      <header className="chat-header">
        <h1>{chat?.title ?? "Messages"}</h1>
        <ModelSelect
          model={model}
          models={models}
          disabled={streaming}
          onChange={onModelChange}
        />
      </header>
      <div className="transcript" ref={scroller}>
        {empty ? (
          <div className="hero">
            <SparkIcon width={28} height={28} />
            <h2>Messages</h2>
            <p>Ask anything. Your history stays on this device, and MCP tools stay attached to each chat.</p>
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
          </div>
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
        {error ? <p className="error-line">{error}</p> : null}
      </div>
      <Composer streaming={streaming} disabled={!hasApiKey} onSend={onSend} onStop={onStop} />
    </section>
  );
}
