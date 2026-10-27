export type HttpMcpServer = {
  type: "http";
  name: string;
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
};

export type StdioMcpServer = {
  type: "stdio";
  name: string;
  enabled: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpServerEntry = HttpMcpServer | StdioMcpServer;

export type AppSettings = {
  apiKey?: string;
  workspace: string;
  defaultModel: string;
  systemPrompt?: string;
  loadUserMcp: boolean;
  loadProjectMcp: boolean;
  mcpServers: McpServerEntry[];
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
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ChatSummary = Omit<ChatRecord, "messages">;

export type SettingsPublic = Omit<AppSettings, "apiKey"> & {
  hasApiKey: boolean;
  apiKeySource: "settings" | "env" | "none";
};
