import { useState } from "react";
import type { Settings } from "../types";
import { Button } from "./ui/Button";

type Props = {
  settings: Settings;
  saving: boolean;
  onSave: (
    next: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null },
  ) => Promise<void>;
  onDone?: () => void;
};

export function SettingsPanel({ settings, saving, onSave, onDone }: Props) {
  const [workspace, setWorkspace] = useState(settings.workspace);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt ?? "");
  const [useMemory, setUseMemory] = useState(settings.useMemory ?? false);
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
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload: Partial<Settings> & { apiKey?: string | null; sessionToken?: string | null } = {
      workspace,
      defaultModel,
      systemPrompt,
      useMemory,
      obsidianEnabled,
      obsidianVault,
      obsidianUseAsWorkspace,
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
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
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
            <span>
              Default Vault on for new chats (agent cwd = Obsidian vault so Brief notes are
              readable)
            </span>
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
          <legend>Memory</legend>
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
