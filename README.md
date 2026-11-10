<img src="assets/icon.svg" width="64" height="64" alt="">

# Brief

A ChatGPT-style local agent chat app backed by the [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript). Each conversation is a durable local `Agent`. Follow-ups call `Agent.resume`, so history survives restarts. MCP servers configured in Settings are passed on every create and resume.

**Live:** [https://brief.k4mik4ge.xyz](https://brief.k4mik4ge.xyz)

## Features

- Sidebar of previous chats (rename, delete), stored under `data/chats/`
- Streaming answers, thinking, and expandable tool-call chips
- Usage tab: Cursor account, local token totals, optional plan quota
- Model picker from `Cursor.models.list()`
- HTTP and stdio MCP servers, plus optional `~/.cursor/mcp.json` / `.cursor/mcp.json`
- Local workspace for file tools (`data/workspace` by default)
- Optional site login (`AUTH_USERNAME` / `AUTH_PASSWORD`)
- ASD-STE100 reply style guide on the first message of each chat
- Optional Obsidian sync: Topics (and Saved stories) write linked markdown under `Brief/` in a local vault (Settings → Obsidian). Enable **Use vault as chat workspace** so agents can read those notes.

## Obsidian vault contract

Brief owns files under `Brief/` only. Other ingest sources should use a different `source` / `id` namespace and must not overwrite Brief-managed frontmatter above `<!-- brief:generated -->`. Put personal edits below `<!-- brief:user -->`.

| Path | Role |
|------|------|
| `Brief/Index.md` | Hub linking current topic notes |
| `Brief/Topics/<Topic>.md` | One note per interest |
| `Brief/Stories/<Title> (<id>).md` | One note per story |
| `Brief/Entities/<Name>.md` | Shared graph nodes (people/orgs/places/products + publishers) |
| `Brief/Chats/<Title> (<id>).md` | Full chat transcript via header **Add to Obsidian** (`source: brief-chat`) |

Frontmatter includes `id`, `source` (`brief-topics` \| `brief-saved`), `type`, `tags`, and `contentHash` (unchanged notes are skipped on sync).

## Requirements

- Node.js 22.13 or later (this repo has an `.nvmrc`)
- A Cursor user API key or service-account key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)

## Run

```bash
nvm use
cp .env.example .env   # then set CURSOR_API_KEY
npm install
npm run dev
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). The Vite app proxies `/api` to the Express server on port 3847.

You can also paste the API key in **Settings** instead of using the environment variable.

## How it talks to the SDK

| App action | SDK call |
| --- | --- |
| First message in a chat | `Agent.create({ local: { cwd }, model, mcpServers })` |
| Later messages / process restart | `Agent.resume(agentId, { local, model, mcpServers })` |
| Stream tokens and tools | `agent.send()` + `onDelta` + `run.wait()` |
| Stop generation | `run.cancel()` |
| Delete a chat | `Agent.delete(agentId)` |

Inline MCP servers are not persisted by the SDK. The server keeps your list in `data/settings.json` and sends it again on resume.

## Production

```bash
npm run build
NODE_ENV=production npm start
```

Serves the built UI from `dist/web` on `http://127.0.0.1:3847`.

## Docker

The image is Debian Bookworm (glibc), not Alpine, because `@cursor/sdk` ships native per-arch binaries. Chat history lives in `./data` on the host.

```bash
cp .env.example .env   # set CURSOR_API_KEY
docker compose up --build
```

Then open [http://127.0.0.1:3847](http://127.0.0.1:3847).

```bash
docker compose down
```

The container binds `0.0.0.0:3847`. Local `npm start` still defaults to `127.0.0.1`; set `HOST=0.0.0.0` if you need to expose that process.

## Public URL

The app is published on a Cloudflare tunnel as [https://brief.k4mik4ge.xyz](https://brief.k4mik4ge.xyz). Set `AUTH_USERNAME` and `AUTH_PASSWORD` in `.env` to require a login.

```bash
node scripts/publish-tunnel.mjs
```

That script needs `CLOUDFLARE_API_TOKEN` (zone DNS + account tunnel edit). It points `brief.k4mik4ge.xyz` at `http://127.0.0.1:3847`.

## Credits

Built by [Pulkit Komal](https://github.com/pulkitkomal), **co-authored with [Cursor](https://cursor.com)**. The Cursor AI coding agent pair-programmed the app, SDK wiring, Docker setup, and UI. Every change was reviewed and directed by the project owner.

## License

MIT
