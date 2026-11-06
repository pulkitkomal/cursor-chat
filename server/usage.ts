import { Cursor } from "@cursor/sdk";
import { listChats, readChat } from "./store.ts";
import { resolveApiKey } from "./agent.ts";
import { readTopicsState, storyCount } from "./topics.ts";
import type { AppSettings, TokenUsage } from "./types.ts";

export type UsageBucket = TokenUsage & {
  messages: number;
  chats: number;
};

export type AccountInfo = {
  apiKeyName?: string;
  userId?: number;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  createdAt?: string;
};

export type QuotaPlan = {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
  breakdown?: Record<string, number>;
};

export type QuotaSnapshot = {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
  individualUsage?: {
    plan?: QuotaPlan;
    onDemand?: QuotaPlan;
  };
  teamUsage?: Record<string, unknown>;
  source: "dashboard" | "unavailable";
  warning?: string;
};

export type UsageStats = {
  fetchedAt: number;
  account: AccountInfo | null;
  accountError?: string;
  local: UsageBucket;
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
  quota: QuotaSnapshot;
};

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

function addUsage(target: TokenUsage, next?: TokenUsage) {
  if (!next) return;
  target.inputTokens += next.inputTokens ?? 0;
  target.outputTokens += next.outputTokens ?? 0;
  target.cacheReadTokens += next.cacheReadTokens ?? 0;
  target.cacheWriteTokens += next.cacheWriteTokens ?? 0;
  target.totalTokens += next.totalTokens ?? 0;
  target.reasoningTokens =
    (target.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0);
}

async function fetchQuota(sessionToken?: string): Promise<QuotaSnapshot> {
  const token =
    sessionToken?.trim() ||
    process.env.CURSOR_SESSION_TOKEN?.trim() ||
    process.env.CURSOR_SESSION_COOKIE?.trim() ||
    "";
  if (!token) {
    return {
      source: "unavailable",
      warning:
        "Account quota needs a Cursor session cookie. Add CURSOR_SESSION_TOKEN in .env (WorkosCursorSessionToken from cursor.com), or use a Team Admin API key.",
    };
  }

  try {
    const cookie = token.includes("=")
      ? token
      : `WorkosCursorSessionToken=${token}`;
    const response = await fetch("https://cursor.com/api/usage-summary", {
      headers: {
        Cookie: cookie,
        Accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      return {
        source: "unavailable",
        warning:
          typeof body.error === "string"
            ? body.error
            : typeof body.description === "string"
              ? body.description
              : `Quota request failed (${response.status})`,
      };
    }
    return {
      billingCycleStart: body.billingCycleStart as string | undefined,
      billingCycleEnd: body.billingCycleEnd as string | undefined,
      membershipType: body.membershipType as string | undefined,
      limitType: body.limitType as string | undefined,
      isUnlimited: body.isUnlimited as boolean | undefined,
      autoModelSelectedDisplayMessage: body.autoModelSelectedDisplayMessage as
        | string
        | undefined,
      namedModelSelectedDisplayMessage: body.namedModelSelectedDisplayMessage as
        | string
        | undefined,
      individualUsage: body.individualUsage as QuotaSnapshot["individualUsage"],
      teamUsage: body.teamUsage as Record<string, unknown> | undefined,
      source: "dashboard",
    };
  } catch (error) {
    return {
      source: "unavailable",
      warning: error instanceof Error ? error.message : "Quota fetch failed",
    };
  }
}

async function loadAccount(apiKey?: string): Promise<{
  account: AccountInfo | null;
  accountError?: string;
}> {
  if (!apiKey) {
    return { account: null, accountError: "Add a Cursor API key to load account details." };
  }
  try {
    const me = await Cursor.me({ apiKey });
    return {
      account: {
        apiKeyName: me.apiKeyName,
        userId: me.userId,
        userEmail: me.userEmail,
        userFirstName: me.userFirstName,
        userLastName: me.userLastName,
        createdAt: me.createdAt,
      },
    };
  } catch (error) {
    return {
      account: null,
      accountError: error instanceof Error ? error.message : "Could not load account",
    };
  }
}

async function loadLocalUsage(): Promise<{
  local: UsageBucket;
  agents: UsageStats["agents"];
}> {
  const local: UsageBucket = { ...emptyUsage(), messages: 0, chats: 0 };
  const agents: UsageStats["agents"] = [];
  const chats = await listChats();

  for (const summary of chats) {
    const chat = await readChat(summary.id);
    if (!chat) continue;
    local.chats += 1;
    const chatUsage = emptyUsage();
    let chatMessages = 0;
    for (const message of chat.messages) {
      if (message.usage) {
        local.messages += 1;
        chatMessages += 1;
        addUsage(local, message.usage);
        addUsage(chatUsage, message.usage);
      }
    }
    if (chat.agentId || chatMessages > 0) {
      agents.push({
        agentId: chat.agentId ?? chat.id,
        chatId: chat.id,
        title: chat.title,
        usage: chatUsage,
      });
    }
  }
  return { local, agents };
}

export async function collectUsageStats(
  settings: AppSettings,
): Promise<UsageStats> {
  const { apiKey } = resolveApiKey(settings);
  const [accountResult, localResult, quota, topicsState] = await Promise.all([
    loadAccount(apiKey),
    loadLocalUsage(),
    fetchQuota(settings.sessionToken),
    readTopicsState(),
  ]);

  const lifetime = topicsState.lifetimeUsage ?? emptyUsage();
  const last = topicsState.edition?.usage;

  return {
    fetchedAt: Date.now(),
    account: accountResult.account,
    accountError: accountResult.accountError,
    local: localResult.local,
    topics: {
      ...lifetime,
      refreshes: topicsState.refreshCount ?? 0,
      lastEditionTokens: last?.totalTokens ?? 0,
      ...(topicsState.edition?.fetchedAt
        ? { lastFetchedAt: topicsState.edition.fetchedAt }
        : {}),
      stories: storyCount(topicsState.edition),
    },
    agents: localResult.agents,
    quota,
  };
}
