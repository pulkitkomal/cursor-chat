import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SavedStory, TopicSource } from "../types";
import { Button } from "./ui/Button";

function savedSources(item: SavedStory): TopicSource[] {
  if (item.sources?.length) return item.sources;
  if (item.sourceHints?.length) return item.sourceHints.map((title) => ({ title }));
  return [];
}

type Props = {
  onDone?: () => void;
};

export function SavedPanel({ onDone }: Props) {
  const [items, setItems] = useState<SavedStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.saved();
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved stories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unsave(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.unsaveStory(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove story");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings saved-panel">
      <header className="glass">
        <div>
          <h1>Saved</h1>
          <p className="subtitle">Stories kept from Topics</p>
        </div>
        {onDone ? (
          <Button variant="accent" onClick={onDone}>
            Done
          </Button>
        ) : null}
      </header>

      {error ? <p className="error-line topics-error">{error}</p> : null}

      <div className="topics-scroll">
        {loading ? <p className="hint">Loading saved stories…</p> : null}

        {!loading && items.length === 0 ? (
          <div className="topics-onboarding rise-in">
            <p className="empty-brand">Brief</p>
            <h2>Nothing saved yet</h2>
            <p>Open Topics and save a story to keep it here.</p>
          </div>
        ) : null}

        <div className="saved-list">
          {items.map((item) => (
            <article key={item.id} className="saved-card rise-in">
              {item.image ? (
                <img src={item.image.url} alt={item.image.alt} loading="lazy" />
              ) : null}
              <div className="saved-card-body">
                <p className="topic-kicker">{item.topic}</p>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                {item.bullets?.length ? (
                  <ul>
                    {item.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
                {savedSources(item).length > 0 ? (
                  <ul className="topic-sources" aria-label="Sources">
                    {savedSources(item).map((source) => {
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
                ) : null}
                <div className="saved-card-meta">
                  <span>{new Date(item.savedAt).toLocaleString()}</span>
                  <Button
                    variant="ghost"
                    disabled={busyId === item.id}
                    onClick={() => void unsave(item.id)}
                  >
                    {busyId === item.id ? "Removing…" : "Unsave"}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
