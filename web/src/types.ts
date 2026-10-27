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

export type Settings = {
  workspace: string;
  defaultModel: string;
  systemPrompt?: string;
  loadUserMcp: boolean;
  loadProjectMcp: boolean;
  mcpServers: McpServerEntry[];
  hasApiKey: boolean;
  apiKeySource: "settings" | "env" | "none";
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
  createdAt: number;
  updatedAt: number;
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
