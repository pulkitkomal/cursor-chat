export type Settings = {
  workspace: string;
  defaultModel: string;
  systemPrompt?: string;
  useMemory: boolean;
  obsidianEnabled: boolean;
  obsidianVault: string;
  obsidianUseAsWorkspace: boolean;
  hasApiKey: boolean;
  apiKeySource: "settings" | "env" | "none";
  hasSessionToken?: boolean;
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

export type ChatSummary = {
  id: string;
  title: string;
  agentId?: string;
  model: string;
  useMemory?: boolean;
  useObsidianWorkspace?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type TopicSource = {
  title: string;
  url?: string;
  publisher?: string;
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

export type Chat = ChatSummary & {
  messages: ChatMessage[];
};

export type ModelOption = {
  id: string;
  displayName: string;
};

export type StreamEvent =
  | { event: "user"; data: ChatMessage }
  | { event: "assistant"; data: { id: string } }
  | { event: "title"; data: { title: string } }
  | { event: "agent"; data: { agentId: string } }
  | { event: "run"; data: { runId: string; requestId?: string; agentId: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "thinking"; data: { text: string } }
  | { event: "tool"; data: ToolCallRecord }
  | { event: "error"; data: { message: string; retryable?: boolean } }
  | { event: "done"; data: { status: string; usage?: TokenUsage; message?: ChatMessage } };

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

export type TopicEntityKind = "person" | "org" | "place" | "product" | "other";

export type TopicEntity = {
  name: string;
  kind?: TopicEntityKind;
};

export type TopicStory = {
  title: string;
  summary: string;
  publishedAt?: string;
  bullets?: string[];
  sources?: TopicSource[];
  sourceHints?: string[];
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
  usage?: TokenUsage;
};

export type TopicsRefreshStatus = "idle" | "running" | "error";

export type TopicsState = {
  interests: string[];
  edition: TopicsEdition | null;
  lifetimeUsage?: TokenUsage;
  refreshCount?: number;
  refreshStatus?: TopicsRefreshStatus;
  refreshError?: string;
};

export type UsageStats = {
  fetchedAt: number;
  account: {
    apiKeyName?: string;
    userId?: number;
    userEmail?: string;
    userFirstName?: string;
    userLastName?: string;
    createdAt?: string;
  } | null;
  accountError?: string;
  local: TokenUsage & { messages: number; chats: number };
  topics: TokenUsage & {
    refreshes: number;
    lastEditionTokens: number;
    lastFetchedAt?: number;
    stories: number;
  };
  agents: {
    agentId: string;
    chatId: string;
    title: string;
    usage?: TokenUsage;
    costCents?: number;
    error?: string;
  }[];
  quota: {
    billingCycleStart?: string;
    billingCycleEnd?: string;
    membershipType?: string;
    limitType?: string;
    isUnlimited?: boolean;
    autoModelSelectedDisplayMessage?: string;
    namedModelSelectedDisplayMessage?: string;
    individualUsage?: {
      plan?: {
        enabled?: boolean;
        used?: number;
        limit?: number | null;
        remaining?: number | null;
        autoPercentUsed?: number;
        apiPercentUsed?: number;
        totalPercentUsed?: number;
      };
      onDemand?: {
        enabled?: boolean;
        used?: number;
        limit?: number | null;
        remaining?: number | null;
      };
    };
    source: "dashboard" | "unavailable";
    warning?: string;
  };
};
