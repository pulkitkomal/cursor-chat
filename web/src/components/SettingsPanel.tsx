import { useState } from "react";
import { api } from "../api";
import type { McpServerEntry, Settings } from "../types";
import { Button } from "./ui/Button";


type Props = {
  settings: Settings;
  saving: boolean;
  onSave: (
    next: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null },
  ) => Promise<void>;
  onDone?: () => void;
};

function emptyHttp(): McpServerEntry {
  return { type: "http", name: "", enabled: true, url: "", headers: {} };
}

function emptyStdio(): McpServerEntry {
  return { type: "stdio", name: "", enabled: true, command: "", args: [] };
}

function pairs(record?: Record<string, string>): [string, string][] {
  const entries = Object.entries(record ?? {}) as [string, string][];
  return entries.length > 0 ? entries : [["", ""]];
}

function toRecord(rows: [string, string][]) {
  const record: Record<string, string> = {};
  for (const [key, value] of rows) {
    if (key.trim()) record[key.trim()] = value;
  }
  return record;
}

export function SettingsPanel({ settings, saving, onSave, onDone }: Props) {
  const [workspace, setWorkspace] = useState(settings.workspace);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt ?? "");
  const [useMemory, setUseMemory] = useState(settings.useMemory ?? false);
  const [loadUserMcp, setLoadUserMcp] = useState(settings.loadUserMcp);
  const [loadProjectMcp, setLoadProjectMcp] = useState(settings.loadProjectMcp);
  const [obsidianEnabled, setObsidianEnabled] = useState(
    settings.obsidianEnabled ?? false,
  );
  const [obsidianVault, setObsidianVault] = useState(settings.obsidianVault ?? "");
  const [obsidianUseAsWorkspace, setObsidianUseAsWorkspace] = useState(
    settings.obsidianUseAsWorkspace ?? false,
  );
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const [clearSession, setClearSession] = useState(false);
  const [servers, setServers] = useState<McpServerEntry[]>(settings.mcpServers);
  const [message, setMessage] = useState<string | null>(null);
  const [mcpTest, setMcpTest] = useState<Record<number, string>>({});

  function updateServer(index: number, next: McpServerEntry) {
    setServers((current) => current.map((server, i) => (i === index ? next : server)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null } = {
      workspace,
      defaultModel,
      systemPrompt,
      useMemory,
      loadUserMcp,
      loadProjectMcp,
      obsidianEnabled,
      obsidianVault,
      obsidianUseAsWorkspace,
      mcpServers: servers.filter((server) => server.name.trim()),
    };
    if (clearKey) payload.apiKey = null;
    else if (apiKey.trim()) payload.apiKey = apiKey.trim();
    if (clearSession) payload.sessionToken = null;
    else if (sessionToken.trim()) payload.sessionToken = sessionToken.trim();
    try {
      await onSave(payload);
      setApiKey("");
      setClearKey(false);
      setSessionToken("");
      setClearSession(false);
      setMessage("Saved. The next message will use these MCP servers.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function testServer(index: number, server: McpServerEntry) {
    setMcpTest((current) => ({ ...current, [index]: "Testing…" }));
    try {
      const result = await api.testMcp(server);
      setMcpTest((current) => ({
        ...current,
        [index]: result.ok
          ? result.message || "OK"
          : result.error || result.message || "Failed",
      }));
    } catch (err) {
      setMcpTest((current) => ({
        ...current,
        [index]: err instanceof Error ? err.message : "Test failed",
      }));
    }
  }

  return (
    <section className="settings">
      <header className="glass">
        <h1>Settings</h1>
        {onDone ? (
          <Button variant="accent" onClick={onDone}>
            Done
          </Button>
        ) : (
          <p>Agents stay on this device</p>
        )}
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset>
          <legend>Cursor account</legend>
          <p className="hint">
            {settings.apiKeySource === "settings"
              ? "Using a key saved in this app. Leave the field blank unless you want to replace it."
              : settings.apiKeySource === "env"
                ? "The server already has CURSOR_API_KEY. You can chat without pasting a key here."
                : "No API key yet. Paste a user key from the Cursor dashboard, or set CURSOR_API_KEY on the server."}
          </p>
          {settings.apiKeySource === "env" ? null : (
            <>
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasApiKey ? "••••••••  leave blank to keep" : "cursor_…"}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setClearKey(false);
                  }}
                />
              </label>
              {settings.hasApiKey ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(event) => setClearKey(event.target.checked)}
                  />
                  Remove saved key
                </label>
              ) : null}
            </>
          )}
          <label>
            Session token (optional, for Usage quota)
            <input
              type="password"
              autoComplete="off"
              placeholder={
                settings.hasSessionToken
                  ? "••••••••  leave blank to keep"
                  : "WorkosCursorSessionToken from cursor.com"
              }
              value={sessionToken}
              onChange={(event) => {
                setSessionToken(event.target.value);
                setClearSession(false);
              }}
            />
          </label>
          <p className="hint">
            Used only for dashboard quota on the Usage tab. Prefer{" "}
            <code>CURSOR_SESSION_TOKEN</code> in <code>.env</code> on the server.
          </p>
          {settings.hasSessionToken ? (
            <label className="check">
              <input
                type="checkbox"
                checked={clearSession}
                onChange={(event) => setClearSession(event.target.checked)}
              />
              Remove saved session token
            </label>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Workspace</legend>
          <label>
            Local working directory
            <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          </label>
          <label>
            Default model
            <input
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Obsidian</legend>
          <p className="hint">
            Sync Topics editions into your vault as linked markdown under{" "}
            <code>Brief/</code>. Obsidian Graph uses the wiki links.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={obsidianEnabled}
              onChange={(event) => setObsidianEnabled(event.target.checked)}
            />
            Sync Topics to Obsidian
          </label>
          <label>
            Vault path
            <input
              value={obsidianVault}
              onChange={(event) => setObsidianVault(event.target.value)}
              placeholder="/path/to/vault"
              disabled={!obsidianEnabled}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={obsidianUseAsWorkspace}
              onChange={(event) => setObsidianUseAsWorkspace(event.target.checked)}
              disabled={!obsidianEnabled}
            />
            Use vault as chat workspace (agents can read Brief notes)
          </label>
        </fieldset>

        <fieldset>
          <legend>Reply style</legend>
          <label>
            Reply style guide
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Optional. Applied on the first message in each chat (ASD-STE100 by default)."
            />
          </label>
          <p className="hint">
            Cursor custom system prompts need account access. Brief prepends this guide to the
            first user message instead, so STE still works without that flag.
          </p>
        </fieldset>

        <fieldset>
          <legend>Memory & MCP sources</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={useMemory}
              onChange={(event) => setUseMemory(event.target.checked)}
            />
            <span>
              Default Memory on for new chats (Cursor user memories / rules via{" "}
              <code>settingSources: user</code>)
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={loadProjectMcp}
              onChange={(event) => setLoadProjectMcp(event.target.checked)}
            />
            <span>
              Load project servers from <code>.cursor/mcp.json</code>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={loadUserMcp}
              onChange={(event) => setLoadUserMcp(event.target.checked)}
            />
            <span>
              Load user servers from <code>~/.cursor/mcp.json</code>
            </span>
          </label>
        </fieldset>

        <fieldset className="mcp-list">
          <legend>Inline MCP servers</legend>
          <p className="hint">
            These are passed into <code>Agent.create</code> and again on <code>Agent.resume</code>.
            Inline servers are not persisted by the SDK.
          </p>
          {servers.map((server, index) => (
            <article key={`${server.type}-${index}`} className="mcp-card">
              <div className="mcp-head">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(event) =>
                      updateServer(index, { ...server, enabled: event.target.checked })
                    }
                  />
                  Enabled
                </label>
                <select
                  value={server.type}
                  onChange={(event) => {
                    const type = event.target.value as McpServerEntry["type"];
                    updateServer(
                      index,
                      type === "http"
                        ? { ...emptyHttp(), name: server.name, enabled: server.enabled }
                        : { ...emptyStdio(), name: server.name, enabled: server.enabled },
                    );
                  }}
                >
                  <option value="http">HTTP</option>
                  <option value="stdio">stdio</option>
                </select>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void testServer(index, server)}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => setServers((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              {mcpTest[index] ? <p className="hint">{mcpTest[index]}</p> : null}
              <label>
                Name
                <input
                  value={server.name}
                  onChange={(event) => updateServer(index, { ...server, name: event.target.value })}
                  placeholder="docs"
                />
              </label>
              {server.type === "http" ? (
                <>
                  <label>
                    URL
                    <input
                      value={server.url}
                      onChange={(event) =>
                        updateServer(index, { ...server, url: event.target.value })
                      }
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                  <KeyValue
                    label="Headers"
                    rows={pairs(server.headers)}
                    onChange={(rows) =>
                      updateServer(index, { ...server, headers: toRecord(rows) })
                    }
                  />
                </>
              ) : (
                <>
                  <label>
                    Command
                    <input
                      value={server.command}
                      onChange={(event) =>
                        updateServer(index, { ...server, command: event.target.value })
                      }
                      placeholder="npx"
                    />
                  </label>
                  <label>
                    Args (space-separated)
                    <input
                      value={(server.args ?? []).join(" ")}
                      onChange={(event) =>
                        updateServer(index, {
                          ...server,
                          args: event.target.value.split(/\s+/).filter(Boolean),
                        })
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                    />
                  </label>
                  <label>
                    Server cwd
                    <input
                      value={server.cwd ?? ""}
                      onChange={(event) =>
                        updateServer(index, { ...server, cwd: event.target.value || undefined })
                      }
                    />
                  </label>
                  <KeyValue
                    label="Env"
                    rows={pairs(server.env)}
                    onChange={(rows) => updateServer(index, { ...server, env: toRecord(rows) })}
                  />
                </>
              )}
            </article>
          ))}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setServers((s) => [...s, emptyHttp()])}>
              Add HTTP server
            </button>
            <button type="button" className="ghost" onClick={() => setServers((s) => [...s, emptyStdio()])}>
              Add stdio server
            </button>
          </div>
        </fieldset>

        <div className="row">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {message ? <p className="hint">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}

function KeyValue({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: [string, string][];
  onChange: (rows: [string, string][]) => void;
}) {
  return (
    <div className="kv">
      <span>{label}</span>
      {rows.map(([key, value], index) => (
        <div key={index} className="kv-row">
          <input
            placeholder="name"
            value={key}
            onChange={(event) => {
              const next = [...rows] as [string, string][];
              next[index] = [event.target.value, value];
              onChange(next);
            }}
          />
          <input
            placeholder="value"
            value={value}
            onChange={(event) => {
              const next = [...rows] as [string, string][];
              next[index] = [key, event.target.value];
              onChange(next);
            }}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() => onChange([...rows, ["", ""] as [string, string]])}
      >
        Add pair
      </button>
    </div>
  );
}
