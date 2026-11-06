import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { UsageStats } from "../types";
import { Button } from "./ui/Button";

type Props = {
  onDone?: () => void;
  onOpenSettings?: () => void;
};

function formatTokens(value: number) {
  return value.toLocaleString();
}

function formatCents(cents?: number) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function percent(used?: number, limit?: number | null) {
  if (used == null || limit == null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

function Meter({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used?: number;
  limit?: number | null;
  hint?: string;
}) {
  const pct = percent(used, limit);
  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <strong>{label}</strong>
        <span>
          {used == null ? "—" : used.toLocaleString()}
          {limit != null ? ` / ${limit.toLocaleString()}` : ""}
        </span>
      </div>
      <div className="usage-meter-track" aria-hidden="true">
        <span style={{ width: `${pct ?? 0}%` }} />
      </div>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

export function UsagePanel({ onDone, onOpenSettings }: Props) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.usage());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = stats?.quota.individualUsage?.plan;
  const onDemand = stats?.quota.individualUsage?.onDemand;
  const name = [stats?.account?.userFirstName, stats?.account?.userLastName]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="settings usage-panel">
      <header className="glass">
        <h1>Usage</h1>
        <div className="usage-header-actions">
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          {onDone ? (
            <Button variant="accent" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="usage-grid">
        <article className="usage-hero glass rise-in">
          <p className="usage-hero-label">Brief local tokens</p>
          <p className="usage-hero-value">
            {formatTokens(
              (stats?.local.totalTokens ?? 0) + (stats?.topics?.totalTokens ?? 0),
            )}
          </p>
          <p className="hint">
            {(stats?.local.chats ?? 0).toLocaleString()} chats
            {(stats?.topics?.refreshes ?? 0) > 0
              ? ` · ${(stats?.topics?.refreshes ?? 0).toLocaleString()} Topics refreshes`
              : ""}{" "}
            on this device
          </p>
          <div className="usage-stats usage-stats-inline">
            <div>
              <strong>{formatTokens(stats?.local.totalTokens ?? 0)}</strong>
              <span>Chats</span>
            </div>
            <div>
              <strong>{formatTokens(stats?.topics?.totalTokens ?? 0)}</strong>
              <span>Topics</span>
            </div>
            <div>
              <strong>
                {formatTokens(
                  (stats?.local.inputTokens ?? 0) + (stats?.topics?.inputTokens ?? 0),
                )}
              </strong>
              <span>Input</span>
            </div>
            <div>
              <strong>
                {formatTokens(
                  (stats?.local.outputTokens ?? 0) + (stats?.topics?.outputTokens ?? 0),
                )}
              </strong>
              <span>Output</span>
            </div>
          </div>
        </article>

        <article className="usage-card glass rise-in delay-1">
          <h2>Topics briefings</h2>
          <dl className="usage-dl">
            <div>
              <dt>Lifetime tokens</dt>
              <dd>{formatTokens(stats?.topics?.totalTokens ?? 0)}</dd>
            </div>
            <div>
              <dt>Last edition</dt>
              <dd>
                {formatTokens(stats?.topics?.lastEditionTokens ?? 0)}
                {stats?.topics?.lastFetchedAt
                  ? ` · ${new Date(stats.topics.lastFetchedAt).toLocaleString()}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Refreshes</dt>
              <dd>{(stats?.topics?.refreshes ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Stories in edition</dt>
              <dd>{(stats?.topics?.stories ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Input / output</dt>
              <dd>
                {formatTokens(stats?.topics?.inputTokens ?? 0)} /{" "}
                {formatTokens(stats?.topics?.outputTokens ?? 0)}
              </dd>
            </div>
          </dl>
        </article>

        <article className="usage-card glass rise-in delay-1">
          <h2>Cursor account</h2>
          {stats?.accountError ? <p className="hint">{stats.accountError}</p> : null}
          {stats?.account ? (
            <dl className="usage-dl">
              <div>
                <dt>Name</dt>
                <dd>{name || "—"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{stats.account.userEmail || "—"}</dd>
              </div>
              <div>
                <dt>API key</dt>
                <dd>{stats.account.apiKeyName || "—"}</dd>
              </div>
            </dl>
          ) : null}
        </article>

        <article className="usage-card glass rise-in delay-2">
          <h2>Plan quota</h2>
          {stats?.quota.source === "dashboard" ? (
            <>
              <p className="hint">
                {[stats.quota.membershipType, stats.quota.limitType]
                  .filter(Boolean)
                  .join(" · ") || "Current billing cycle"}
                {stats.quota.billingCycleStart && stats.quota.billingCycleEnd
                  ? ` · ${new Date(stats.quota.billingCycleStart).toLocaleDateString()} – ${new Date(stats.quota.billingCycleEnd).toLocaleDateString()}`
                  : ""}
              </p>
              <Meter
                label="Included plan"
                used={plan?.used}
                limit={plan?.limit}
                hint={
                  plan?.totalPercentUsed != null
                    ? `${Math.round(plan.totalPercentUsed)}% of included usage`
                    : stats.quota.namedModelSelectedDisplayMessage
                }
              />
              <Meter
                label="On-demand"
                used={onDemand?.used}
                limit={onDemand?.limit}
                hint={
                  onDemand?.enabled === false
                    ? "On-demand disabled"
                    : "Spend-style units from Cursor usage summary"
                }
              />
            </>
          ) : (
            <div className="usage-empty">
              <p>{stats?.quota.warning || "Quota unavailable."}</p>
              {onOpenSettings ? (
                <Button variant="primary" onClick={onOpenSettings}>
                  Add session token in Settings
                </Button>
              ) : null}
            </div>
          )}
        </article>

        <article className="usage-card glass rise-in delay-3 usage-span">
          <h2>Per chat</h2>
          {!stats || stats.agents.length === 0 ? (
            <p className="hint">No chat usage reported yet.</p>
          ) : (
            <ul className="usage-agents">
              {stats.agents.map((agent) => (
                <li key={agent.chatId}>
                  <div>
                    <strong>{agent.title}</strong>
                    <span>{agent.agentId}</span>
                  </div>
                  {agent.error ? (
                    <em>{agent.error}</em>
                  ) : (
                    <em>
                      {formatTokens(agent.usage?.totalTokens ?? 0)} tokens
                      {agent.costCents != null ? ` · ${formatCents(agent.costCents)}` : ""}
                    </em>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
      {stats ? (
        <p className="hint usage-fetched">
          Updated {new Date(stats.fetchedAt).toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}
