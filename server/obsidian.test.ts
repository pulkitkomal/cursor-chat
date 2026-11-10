import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  chatNoteId,
  renderChatNote,
  renderStoryNote,
  renderTopicNote,
  slugifyFilename,
  stableContentHash,
  storyNoteId,
  syncChatToObsidian,
  syncSavedStoryToObsidian,
  syncTopicsEditionToObsidian,
  topicNoteId,
} from "./obsidian.ts";
import type { AppSettings, TopicsEdition } from "./types.ts";

function settingsFor(vault: string, enabled = true): AppSettings {
  return {
    workspace: vault,
    defaultModel: "auto",
    useMemory: false,
    loadUserMcp: false,
    loadProjectMcp: false,
    mcpServers: [],
    obsidianEnabled: enabled,
    obsidianVault: vault,
    obsidianUseAsWorkspace: false,
  };
}

describe("obsidian note helpers", () => {
  it("slugifyFilename strips path-unsafe characters", () => {
    assert.equal(slugifyFilename('AI / ML: "notes"?'), "AI ML notes");
    assert.equal(slugifyFilename("   "), "untitled");
  });

  it("keeps stable story ids for the same topic+title", () => {
    const a = storyNoteId("AI", "Open models surge");
    const b = storyNoteId("ai", "Open models surge");
    const c = storyNoteId("AI", "Different title");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^brief:story:[a-f0-9]{12}$/);
  });

  it("builds topic ids from normalized names", () => {
    assert.equal(topicNoteId("  Markets "), "brief:topic:markets");
  });

  it("stableContentHash ignores syncedAt volatility", () => {
    const a = "---\nsyncedAt: 2020-01-01\n---\nbody";
    const b = "---\nsyncedAt: 2021-01-01\n---\nbody";
    assert.equal(stableContentHash(a), stableContentHash(b));
  });

  it("renders deterministic markdown for the same inputs", () => {
    const syncedAt = 1_700_000_000_000;
    const editionFetchedAt = 1_700_000_100_000;
    const section = {
      topic: "AI",
      headline: "Models move",
      dek: "A short dek.",
      stories: [
        {
          title: "Open models surge",
          summary: "Open weights gained ground.",
          publishedAt: "2026-11-09",
          bullets: ["One", "Two"],
          sources: [{ title: "Wire", url: "https://example.com", publisher: "Reuters" }],
          entities: [{ name: "OpenAI", kind: "org" as const }],
        },
      ],
      figures: [{ kind: "stat" as const, title: "Deals", value: "3", unit: "rounds" }],
    };
    const storyPaths = [
      {
        title: "Open models surge",
        notePath: "Brief/Stories/Open models surge (abc)",
      },
    ];
    const first = renderTopicNote({ section, syncedAt, editionFetchedAt, storyPaths });
    const second = renderTopicNote({ section, syncedAt, editionFetchedAt, storyPaths });
    assert.equal(first, second);

    const story = renderStoryNote({
      topic: "AI",
      story: section.stories[0],
      syncedAt,
      editionFetchedAt,
      topicNotePath: "Brief/Topics/AI",
      entityPaths: [
        { name: "OpenAI", notePath: "Brief/Entities/OpenAI" },
        { name: "Reuters", notePath: "Brief/Entities/Reuters" },
      ],
      source: "brief-topics",
    });
    assert.match(story, /id: "brief:story:[a-f0-9]{12}"/);
    assert.match(story, /\[\[Brief\/Entities\/OpenAI\]\]/);
    assert.match(story, /\[\[Brief\/Entities\/Reuters\]\]/);
  });
});

describe("syncTopicsEditionToObsidian", () => {
  it("writes notes and skips unchanged rewrites", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "brief-obsidian-"));
    try {
      const settings = settingsFor(vault);
      const edition: TopicsEdition = {
        fetchedAt: 1_700_000_100_000,
        sections: [
          {
            topic: "AI",
            headline: "Models move",
            dek: "A short dek.",
            stories: [
              {
                title: "Open models surge",
                summary: "Open weights gained ground.",
                entities: [{ name: "OpenAI", kind: "org" }],
                sources: [
                  { title: "Wire", url: "https://example.com/a", publisher: "Reuters" },
                ],
              },
            ],
            figures: [],
          },
        ],
      };

      const first = await syncTopicsEditionToObsidian(settings, edition);
      assert.equal(first.ok, true);
      assert.equal(first.topicNotes, 1);
      assert.equal(first.storyNotes, 1);
      assert.ok(first.entityNotes >= 1);

      const second = await syncTopicsEditionToObsidian(settings, edition);
      assert.equal(second.ok, true);
      assert.ok(second.skippedNotes > 0);
      assert.equal(second.topicNotes, 0);
      assert.equal(second.storyNotes, 0);

      const storyDir = path.join(vault, "Brief", "Stories");
      const { readdir } = await import("node:fs/promises");
      const stories = await readdir(storyDir);
      assert.equal(stories.length, 1);
      const storyBody = await readFile(path.join(storyDir, stories[0]), "utf8");
      assert.match(storyBody, /contentHash:/);
      assert.match(storyBody, /\[\[Brief\/Entities\/OpenAI\]\]/);
      assert.match(storyBody, /\[\[Brief\/Entities\/Reuters\]\]/);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("preserves user edits below the user marker", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "brief-obsidian-user-"));
    try {
      const settings = settingsFor(vault);
      const edition: TopicsEdition = {
        fetchedAt: 1_700_000_100_000,
        sections: [
          {
            topic: "AI",
            headline: "Models move",
            dek: "A short dek.",
            stories: [{ title: "Story A", summary: "Summary A." }],
            figures: [],
          },
        ],
      };
      await syncTopicsEditionToObsidian(settings, edition);
      const topicPath = path.join(vault, "Brief", "Topics", "AI.md");
      const existing = await readFile(topicPath, "utf8");
      await writeFile(
        topicPath,
        `${existing.trimEnd()}\n\n<!-- brief:user -->\nMy personal note\n`,
        "utf8",
      );

      edition.sections[0].dek = "Updated dek.";
      await syncTopicsEditionToObsidian(settings, edition);
      const updated = await readFile(topicPath, "utf8");
      assert.match(updated, /Updated dek/);
      assert.match(updated, /<!-- brief:user -->/);
      assert.match(updated, /My personal note/);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("skips when sync is disabled", async () => {
    const result = await syncTopicsEditionToObsidian(
      settingsFor("/tmp/does-not-matter", false),
      { fetchedAt: Date.now(), sections: [] },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.topicNotes, 0);
  });
});

describe("syncChatToObsidian", () => {
  it("writes one note for the full transcript", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "brief-obsidian-chat-"));
    try {
      const input = {
        chatId: "chat-1",
        chatTitle: "Plan the feature",
        messages: [
          {
            id: "msg-1",
            role: "user" as const,
            text: "How should we add chat export?",
            createdAt: 1_700_000_000_000,
          },
          {
            id: "msg-2",
            role: "assistant" as const,
            text: "Touch server/obsidian.ts and ChatView.",
            createdAt: 1_700_000_000_100,
          },
        ],
      };
      assert.equal(chatNoteId("chat-1"), chatNoteId("chat-1"));
      const rendered = renderChatNote({ ...input, syncedAt: 1_700_000_000_200 });
      assert.match(rendered, /source: brief-chat/);
      assert.match(rendered, /## User/);
      assert.match(rendered, /## Assistant/);

      const result = await syncChatToObsidian(settingsFor(vault), input);
      assert.equal(result.ok, true);
      assert.equal(result.messageCount, 2);
      assert.ok(result.notePath?.includes("Brief/Chats/"));
      const body = await readFile(path.join(vault, result.notePath!), "utf8");
      assert.match(body, /Touch server\/obsidian\.ts/);
      assert.match(body, /How should we add chat export/);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });
});

describe("syncSavedStoryToObsidian", () => {
  it("writes a brief-saved story note", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "brief-obsidian-saved-"));
    try {
      const result = await syncSavedStoryToObsidian(settingsFor(vault), {
        id: "saved-1",
        savedAt: Date.now(),
        topic: "AI",
        title: "Keep this story",
        summary: "A saved briefing item.",
        entities: [{ name: "Anthropic", kind: "org" }],
      });
      assert.equal(result.ok, true);
      assert.equal(result.storyNotes, 1);
      const storyDir = path.join(vault, "Brief", "Stories");
      const { readdir } = await import("node:fs/promises");
      const stories = await readdir(storyDir);
      assert.equal(stories.length, 1);
      const body = await readFile(path.join(storyDir, stories[0]), "utf8");
      assert.match(body, /source: brief-saved/);
      assert.match(body, /\[\[Brief\/Entities\/Anthropic\]\]/);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });
});
