import { useEffect, useId, useState } from "react";
import { api } from "../api";
import type { Theme } from "../theme";
import { Button } from "./ui/Button";
import { MoonIcon, SunIcon } from "./Icons";
import { IconButton } from "./ui/IconButton";

type Props = {
  onLoggedIn: () => void;
  theme: Theme;
  onToggleTheme: () => void;
};

type LegalPanel = "license" | "notices" | null;

const MIT_LICENSE = `MIT License

Copyright (c) 2026 Pulkit Komal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function Login({ onLoggedIn, theme, onToggleTheme }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legal, setLegal] = useState<LegalPanel>(null);
  const titleId = useId();

  useEffect(() => {
    if (!legal) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLegal(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legal]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="ambient" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <IconButton
        label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="theme-fab"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
      </IconButton>

      <div className="login-shell">
        <header className="login-hero">
          <img src="/brief.svg" alt="" width={48} height={48} />
          <p className="login-brand">Brief</p>
          <h1>Clear answers from local Cursor agents.</h1>
          <p className="login-lede">
            History stays on this device. Replies follow Simplified Technical English.
          </p>
        </header>

        <form className="login-card glass" onSubmit={(event) => void submit(event)}>
          <div className="login-fields">
            <label>
              Email or username
              <input
                autoComplete="username"
                inputMode="email"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </div>
          {error ? <p className="error-line">{error}</p> : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !username || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <footer className="login-legal">
          <p>© 2026 Pulkit Komal. All rights reserved where not licensed.</p>
          <nav aria-label="Legal">
            <button type="button" onClick={() => setLegal("license")}>
              MIT License
            </button>
            <span aria-hidden="true">·</span>
            <a href="/LICENSE.txt" target="_blank" rel="noreferrer">
              License text
            </a>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => setLegal("notices")}>
              Notices
            </button>
          </nav>
          <p className="login-version">Brief 0.1.0</p>
        </footer>
      </div>

      {legal ? (
        <div
          className="login-dialog-backdrop"
          role="presentation"
          onClick={() => setLegal(null)}
        >
          <div
            className="login-dialog glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id={titleId}>{legal === "license" ? "MIT License" : "Notices"}</h2>
              <Button variant="ghost" type="button" onClick={() => setLegal(null)}>
                Close
              </Button>
            </header>
            {legal === "license" ? (
              <pre className="login-license">{MIT_LICENSE}</pre>
            ) : (
              <div className="login-notices">
                <p>
                  Brief is copyright © 2026 Pulkit Komal and is released under the MIT
                  License.
                </p>
                <p>
                  Cursor® and related marks are trademarks of Anysphere, Inc. Brief is
                  an independent project and is not affiliated with, endorsed by, or
                  sponsored by Anysphere or Cursor.
                </p>
                <p>
                  The Cursor Agent SDK and model services are subject to Cursor’s own
                  terms. Use of those services requires your own Cursor API credentials.
                </p>
                <p>
                  ASD-STE100 is a trademark of the AeroSpace and Defence Industries
                  Association of Europe. Brief applies a practical writing style inspired
                  by Simplified Technical English; it is not an official STE product.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
