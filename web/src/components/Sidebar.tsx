import { ChatIcon, CloseIcon, PlusIcon, SettingsIcon, TrashIcon } from "./Icons";
import type { ChatSummary } from "../types";

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

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  settingsOpen: boolean;
  username?: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onClose?: () => void;
  onLogout?: () => void;
};

export function Sidebar({
  chats,
  activeId,
  settingsOpen,
  onNew,
  onSelect,
  onDelete,
  onOpenSettings,
  username,
  onClose,
  onLogout,
}: Props) {
  const groups = groupChats(chats);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-copy">
          <strong>Chats</strong>
          <span>On this device</span>
        </div>
        <button type="button" className="icon-btn" aria-label="New chat" onClick={onNew}>
          <PlusIcon width={18} height={18} />
        </button>
        {onClose ? (
          <button type="button" className="icon-btn close-sidebar" aria-label="Close sidebar" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
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
                  <li key={chat.id}>
                    <button
                      type="button"
                      className={chat.id === activeId && !settingsOpen ? "active" : ""}
                      onClick={() => onSelect(chat.id)}
                    >
                      <ChatIcon width={15} height={15} />
                      <span>{chat.title}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      aria-label={`Delete ${chat.title}`}
                      onClick={() => onDelete(chat.id)}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
      <div className="sidebar-foot">
        <button
          type="button"
          className={`settings-link ${settingsOpen ? "active" : ""}`}
          onClick={onOpenSettings}
        >
          <SettingsIcon width={18} height={18} />
          Settings
        </button>
        {onLogout ? (
          <button type="button" className="settings-link" onClick={onLogout}>
            Sign Out
          </button>
        ) : null}
        {username ? <p className="empty-list">{username}</p> : null}
      </div>
    </aside>
  );
}
