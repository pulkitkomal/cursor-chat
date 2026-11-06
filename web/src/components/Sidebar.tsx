import { useState } from "react";
import {
  ChartIcon,
  ChatIcon,
  CloseIcon,
  MoonIcon,
  PlusIcon,
  SavedIcon,
  SettingsIcon,
  SunIcon,
  TopicsIcon,
  TrashIcon,
} from "./Icons";
import type { ChatSummary } from "../types";
import type { Theme } from "../theme";
import { IconButton } from "./ui/IconButton";

function groupChats(chats: ChatSummary[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const groups: { label: string; items: ChatSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const chat of chats) {
    if (chat.updatedAt >= startOfToday) groups[0].items.push(chat);
    else if (chat.updatedAt >= startOfYesterday) groups[1].items.push(chat);
    else if (chat.updatedAt >= startOfWeek) groups[2].items.push(chat);
    else groups[3].items.push(chat);
  }
  return groups.filter((group) => group.items.length > 0);
}

type Panel = "chat" | "settings" | "usage" | "topics" | "saved";

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  panel: Panel;
  username?: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
  onOpenTopics: () => void;
  onOpenSaved: () => void;
  onClose?: () => void;
  onLogout?: () => void;
  theme: Theme;
  onToggleTheme: () => void;
};

export function Sidebar({
  chats,
  activeId,
  panel,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onOpenSettings,
  onOpenUsage,
  onOpenTopics,
  onOpenSaved,
  username,
  onClose,
  onLogout,
  theme,
  onToggleTheme,
}: Props) {
  const groups = groupChats(chats);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startRename(chat: ChatSummary) {
    setEditingId(chat.id);
    setDraft(chat.title);
  }

  function commitRename() {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRename(editingId, title);
    setEditingId(null);
  }

  return (
    <aside className="sidebar glass">
      <div className="brand">
        <div className="brand-copy">
          <img src="/brief.svg" alt="" width={28} height={28} />
          <div>
            <strong>Brief</strong>
            <span>Clear local agents</span>
          </div>
        </div>
        <IconButton label="New chat" onClick={onNew}>
          <PlusIcon width={16} height={16} />
        </IconButton>
        {onClose ? (
          <IconButton label="Close sidebar" className="close-sidebar" onClick={onClose}>
            <CloseIcon width={16} height={16} />
          </IconButton>
        ) : null}
      </div>
      <nav className="chat-list" aria-label="Chat history">
        {chats.length === 0 ? (
          <p className="empty-list">Previous chats will appear here.</p>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((chat) => (
                  <li key={chat.id} className="chat-row">
                    {editingId === chat.id ? (
                      <form
                        className="rename-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitRename();
                        }}
                      >
                        <input
                          value={draft}
                          autoFocus
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          aria-label="Rename chat"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        className={chat.id === activeId && panel === "chat" ? "active" : ""}
                        onClick={() => onSelect(chat.id)}
                        onDoubleClick={() => startRename(chat)}
                        title="Double-click to rename"
                      >
                        <ChatIcon width={14} height={14} />
                        <span>{chat.title}</span>
                      </button>
                    )}
                    <IconButton
                      label={`Delete ${chat.title}`}
                      tone="danger"
                      onClick={() => onDelete(chat.id)}
                    >
                      <TrashIcon width={14} height={14} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-tools">
          <button
            type="button"
            className={`settings-link ${panel === "topics" ? "active" : ""}`}
            onClick={onOpenTopics}
          >
            <TopicsIcon width={15} height={15} />
            Topics
          </button>
          <button
            type="button"
            className={`settings-link ${panel === "saved" ? "active" : ""}`}
            onClick={onOpenSaved}
          >
            <SavedIcon width={15} height={15} />
            Saved
          </button>
          <button
            type="button"
            className={`settings-link ${panel === "usage" ? "active" : ""}`}
            onClick={onOpenUsage}
          >
            <ChartIcon width={15} height={15} />
            Usage
          </button>
          <button
            type="button"
            className={`settings-link ${panel === "settings" ? "active" : ""}`}
            onClick={onOpenSettings}
          >
            <SettingsIcon width={15} height={15} />
            Settings
          </button>
        </div>
        <div className="sidebar-account">
          <IconButton
            label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <SunIcon width={15} height={15} /> : <MoonIcon width={15} height={15} />}
          </IconButton>
          {username ? <p>{username}</p> : <span />}
          {onLogout ? (
            <button type="button" className="text-link" onClick={onLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
