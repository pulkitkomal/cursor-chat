export type AppSettings = {
  apiKey?: string;
  /** Optional WorkosCursorSessionToken for dashboard quota/usage-summary. */
  sessionToken?: string;
  workspace: string;
  defaultModel: string;
  systemPrompt?: string;
  /** Load Cursor user settingSources (memories/rules) into local agents. */
  useMemory: boolean;
  /** Write Topics editions into an Obsidian vault as linked markdown. */
  obsidianEnabled: boolean;
  /** Absolute path to the Obsidian vault root on this machine. */
  obsidianVault: string;
  /** Default for new chats: use the Obsidian vault as agent cwd. */
  obsidianUseAsWorkspace: boolean;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type ToolCallRecord = {
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  thinking?: string;
  tools?: ToolCallRecord[];
  usage?: TokenUsage;
};

export type ChatRecord = {
  id: string;
  title: string;
  agentId?: string;
  model: string;
  /** When set, overrides AppSettings.useMemory for this chat. */
  useMemory?: boolean;
  /** When set, overrides AppSettings.obsidianUseAsWorkspace for this chat. */
  useObsidianWorkspace?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ChatSummary = Omit<ChatRecord, "messages">;

export type SettingsPublic = Omit<AppSettings, "apiKey"> & {
  hasApiKey: boolean;
  apiKeySource: "settings" | "env" | "none";
};

export type TopicFigure =
  | {
      kind: "stat";
      title: string;
      value: string;
      unit?: string;
      hint?: string;
    }
  | {
      kind: "bar" | "line";
      title: string;
      series: { label: string; value: number }[];
      unit?: string;
    };

export type TopicSource = {
  title: string;
  url?: string;
  publisher?: string;
};

export type TopicEntityKind = "person" | "org" | "place" | "product" | "other";

export type TopicEntity = {
  name: string;
  kind?: TopicEntityKind;
};

export type TopicStory = {
  title: string;
  summary: string;
  /** ISO date (YYYY-MM-DD) when the story broke / was published. */
  publishedAt?: string;
  bullets?: string[];
  /** Structured citations; preferred over sourceHints. */
  sources?: TopicSource[];
  /** Legacy free-text source labels. */
  sourceHints?: string[];
  /** Named entities for Obsidian graph links. */
  entities?: TopicEntity[];
  image?: { url: string; alt: string; credit?: string };
};

export type TopicSection = {
  topic: string;
  headline: string;
  dek: string;
  stories: TopicStory[];
  figures: TopicFigure[];
  error?: string;
};

export type TopicsEdition = {
  fetchedAt: number;
  sections: TopicSection[];
  /** Token usage for this edition refresh (sum across topic agents). */
  usage?: TokenUsage;
};

export type TopicsRefreshStatus = "idle" | "running" | "error";

export type TopicsState = {
  interests: string[];
  edition: TopicsEdition | null;
  /** Cumulative Topics refresh usage on this device. */
  lifetimeUsage?: TokenUsage;
  refreshCount?: number;
  /** Ephemeral — set by the API while a background refresh is in flight. */
  refreshStatus?: TopicsRefreshStatus;
  refreshError?: string;
};

export type SavedStory = {
  id: string;
  savedAt: number;
  topic: string;
  title: string;
  summary: string;
  bullets?: string[];
  sources?: TopicSource[];
  sourceHints?: string[];
  entities?: TopicEntity[];
  image?: { url: string; alt: string; credit?: string };
};

export type ObsidianSyncStatus = {
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastTopicNotes?: number;
  lastStoryNotes?: number;
  lastEntityNotes?: number;
  lastSkippedNotes?: number;
  vaultPath?: string;
};
