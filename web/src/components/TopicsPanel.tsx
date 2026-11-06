import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type {
  TopicFigure,
  TopicSection,
  TopicSource,
  TopicStory,
  TopicsState,
} from "../types";
import { Button } from "./ui/Button";
import { SavedIcon } from "./Icons";

type Props = {
  hasApiKey: boolean;
  onDone?: () => void;
  onOpenSettings?: () => void;
};

const SUGGESTIONS = [
  "AI agents",
  "Climate tech",
  "Personal finance",
  "Spaceflight",
  "Local food systems",
];

function FigureCard({ figure }: { figure: TopicFigure }) {
  if (figure.kind === "stat") {
    return (
      <article className="topic-figure topic-stat">
        <p className="topic-figure-label">{figure.title}</p>
        <p className="topic-figure-value">
          {figure.value}
          {figure.unit ? <span>{figure.unit}</span> : null}
        </p>
        {figure.hint ? <p className="hint">{figure.hint}</p> : null}
      </article>
    );
  }

  const max = Math.max(...figure.series.map((point) => Math.abs(point.value)), 1);
  const points = figure.series
    .map((point, index) => {
      const x = (index / Math.max(figure.series.length - 1, 1)) * 100;
      const y = 100 - (Math.abs(point.value) / max) * 78 - 8;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className="topic-figure">
      <p className="topic-figure-label">
        {figure.title}
        {figure.unit ? ` · ${figure.unit}` : ""}
      </p>
      {figure.kind === "line" ? (
        <svg className="topic-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
        </svg>
      ) : (
        <div className="topic-bars" aria-hidden="true">
          {figure.series.map((point) => (
            <div key={point.label} className="topic-bar">
              <span style={{ height: `${(Math.abs(point.value) / max) * 100}%` }} />
              <em>{point.label}</em>
            </div>
          ))}
        </div>
      )}
      <ul className="topic-series">
        {figure.series.map((point) => (
          <li key={point.label}>
            <span>{point.label}</span>
            <strong>
              {point.value}
              {figure.unit ? ` ${figure.unit}` : ""}
            </strong>
          </li>
        ))}
      </ul>
    </article>
  );
}

function storySources(story: TopicStory): TopicSource[] {
  if (story.sources?.length) return story.sources;
  if (story.sourceHints?.length) {
    return story.sourceHints.map((title) => ({ title }));
  }
  return [];
}

function StorySources({ story }: { story: TopicStory }) {
  const sources = storySources(story);
  if (sources.length === 0) return null;
  return (
    <ul className="topic-sources" aria-label="Sources">
      {sources.map((source) => {
        const label = source.publisher
          ? `${source.title} · ${source.publisher}`
          : source.title;
        return (
          <li key={`${source.title}-${source.url ?? ""}`}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SaveStoryButton({
  topic,
  story,
  savedKeys,
  onSaved,
}: {
  topic: string;
  story: TopicStory;
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
}) {
  const key = `${topic.toLowerCase()}::${story.title.toLowerCase()}`;
  const already = savedKeys.has(key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (already || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveStory({ topic, ...story });
      onSaved(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topic-save-wrap">
      <Button variant="ghost" disabled={already || busy} onClick={() => void save()}>
        <SavedIcon width={13} height={13} />
        {already ? "Saved" : busy ? "Saving…" : "Save"}
      </Button>
      {error ? <span className="hint">{error}</span> : null}
    </div>
  );
}

function SectionBlock({
  section,
  savedKeys,
  onSaved,
}: {
  section: TopicSection;
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
}) {
  const [lead, ...rest] = section.stories;
  return (
    <section className="topic-section rise-in">
      <header className="topic-section-head">
        <p className="topic-kicker">{section.topic}</p>
        <h2>{section.headline}</h2>
        <p className="topic-dek">{section.dek}</p>
        {section.error ? <p className="error-line">{section.error}</p> : null}
      </header>

      {lead ? (
        <article className="topic-lead">
          {lead.image ? (
            <figure className="topic-photo">
              <img src={lead.image.url} alt={lead.image.alt} loading="lazy" />
              {lead.image.credit ? <figcaption>{lead.image.credit}</figcaption> : null}
            </figure>
          ) : (
            <div className="topic-photo topic-photo-fallback" aria-hidden="true">
              <span>{section.topic.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          <div className="topic-lead-copy">
            <h3>{lead.title}</h3>
            {lead.publishedAt ? (
              <p className="topic-date">
                {new Date(`${lead.publishedAt}T00:00:00Z`).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </p>
            ) : null}
            <p>{lead.summary}</p>
            {lead.bullets?.length ? (
              <ul>
                {lead.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <StorySources story={lead} />
            <SaveStoryButton
              topic={section.topic}
              story={lead}
              savedKeys={savedKeys}
              onSaved={onSaved}
            />
          </div>
        </article>
      ) : null}

      {rest.length > 0 ? (
        <div className="topic-story-grid">
          {rest.map((story) => (
            <article key={story.title} className="topic-story">
              {story.image ? (
                <img src={story.image.url} alt={story.image.alt} loading="lazy" />
              ) : null}
              <h3>{story.title}</h3>
              {story.publishedAt ? (
                <p className="topic-date">
                  {new Date(`${story.publishedAt}T00:00:00Z`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
              ) : null}
              <p>{story.summary}</p>
              <StorySources story={story} />
              <SaveStoryButton
                topic={section.topic}
                story={story}
                savedKeys={savedKeys}
                onSaved={onSaved}
              />
            </article>
          ))}
        </div>
      ) : null}

      {section.figures.length > 0 ? (
        <div className="topic-figure-grid">
          {section.figures.map((figure, index) => (
            <FigureCard key={`${figure.kind}-${figure.title}-${index}`} figure={figure} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function TopicsPanel({ hasApiKey, onDone, onOpenSettings }: Props) {
  const [state, setState] = useState<TopicsState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [topics, saved] = await Promise.all([api.topics(), api.saved()]);
      setState(topics);
      setSavedKeys(
        new Set(
          saved.items.map(
            (item) => `${item.topic.toLowerCase()}::${item.title.toLowerCase()}`,
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load topics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const interests = state?.interests ?? [];
  const edition = state?.edition ?? null;
  const needsOnboarding = !loading && interests.length === 0;
  const editionTokens = edition?.usage?.totalTokens ?? 0;
  const lifetimeTokens = state?.lifetimeUsage?.totalTokens ?? 0;
  const storyTotal =
    edition?.sections.reduce((sum, section) => sum + section.stories.length, 0) ?? 0;

  async function persistInterests(next: string[], refreshAfter = false) {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveTopicInterests(next);
      setState(saved);
      if (refreshAfter && next.length > 0) {
        await runRefresh(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save topics");
    } finally {
      setSaving(false);
    }
  }

  async function runRefresh(nextInterests?: string[]) {
    if (!hasApiKey) {
      setError("Add a Cursor API key in Settings to refresh topics.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const refreshed = await api.refreshTopics(nextInterests);
      setState(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh topics");
    } finally {
      setRefreshing(false);
    }
  }

  function addTopic(raw: string) {
    const topic = raw.trim().replace(/\s+/g, " ");
    if (!topic) return;
    if (interests.some((item) => item.toLowerCase() === topic.toLowerCase())) {
      setDraft("");
      return;
    }
    const next = [...interests, topic];
    setDraft("");
    void persistInterests(next, interests.length === 0);
  }

  function removeTopic(topic: string) {
    const next = interests.filter((item) => item !== topic);
    void persistInterests(next);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    addTopic(draft);
  }

  return (
    <section className="settings topics-panel">
      <header className="glass">
        <div>
          <h1>Topics</h1>
          <p className="subtitle">
            {edition
              ? [
                  `Edition · ${new Date(edition.fetchedAt).toLocaleString()}`,
                  `${storyTotal} stories`,
                  editionTokens > 0
                    ? `${editionTokens.toLocaleString()} tokens`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : lifetimeTokens > 0
                ? `Personal newspaper briefing · ${lifetimeTokens.toLocaleString()} tokens lifetime`
                : "Personal newspaper briefing"}
          </p>
        </div>
        <div className="usage-header-actions">
          {!needsOnboarding ? (
            <Button
              variant="ghost"
              disabled={refreshing || saving || interests.length === 0}
              onClick={() => void runRefresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          ) : null}
          {onDone ? (
            <Button variant="accent" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <p className="error-line topics-error">{error}</p> : null}

      <div className="topics-scroll">
        {loading ? <p className="hint">Loading topics…</p> : null}

        {needsOnboarding ? (
          <div className="topics-onboarding rise-in">
            <p className="empty-brand">Brief</p>
            <h2>What topics interest you?</h2>
            <p>
              Pick a few beats. Brief will fetch a denser newspaper-style edition with stories from
              the last 3 days, cited sources, images, and figures.
            </p>
            {!hasApiKey ? (
              <button type="button" className="banner" onClick={onOpenSettings}>
                Add a Cursor API key in Settings before the first refresh.
              </button>
            ) : null}
            <div className="topic-suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item} type="button" onClick={() => addTopic(item)} disabled={saving}>
                  {item}
                </button>
              ))}
            </div>
            <form className="topic-add" onSubmit={onSubmit}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a topic"
                aria-label="Add a topic"
              />
              <Button variant="accent" type="submit" disabled={saving || !draft.trim()}>
                Add
              </Button>
            </form>
          </div>
        ) : (
          <>
            <div className="topic-toolbar">
              <div className="topic-chips">
                {interests.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="topic-chip"
                    onClick={() => removeTopic(topic)}
                    title={`Remove ${topic}`}
                  >
                    {topic}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
              <form className="topic-add" onSubmit={onSubmit}>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Add another topic"
                  aria-label="Add another topic"
                />
                <Button variant="ghost" type="submit" disabled={saving || !draft.trim()}>
                  Add
                </Button>
              </form>
            </div>

            {refreshing && !edition ? (
              <p className="hint">Gathering the first edition…</p>
            ) : null}

            {!edition && !refreshing ? (
              <div className="topics-empty">
                <p>No edition yet.</p>
                <Button variant="primary" onClick={() => void runRefresh()} disabled={!hasApiKey}>
                  Fetch edition
                </Button>
              </div>
            ) : null}

            {edition ? (
              <div className="topics-paper">
                <div className="topics-masthead">
                  <p>The Brief</p>
                  <h2>Morning edition</h2>
                  <span>{new Date(edition.fetchedAt).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}</span>
                  <p className="topics-usage-line">
                    {storyTotal} stories
                    {editionTokens > 0
                      ? ` · ${editionTokens.toLocaleString()} tokens this edition`
                      : ""}
                    {lifetimeTokens > 0
                      ? ` · ${lifetimeTokens.toLocaleString()} lifetime`
                      : ""}
                  </p>
                </div>
                {edition.sections.map((section) => (
                  <SectionBlock
                    key={section.topic}
                    section={section}
                    savedKeys={savedKeys}
                    onSaved={(key) =>
                      setSavedKeys((current) => new Set([...current, key]))
                    }
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
