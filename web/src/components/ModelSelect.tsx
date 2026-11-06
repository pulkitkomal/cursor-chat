import { useEffect, useId, useRef, useState } from "react";
import type { ModelOption } from "../types";

type Props = {
  model: string;
  models: ModelOption[];
  disabled?: boolean;
  onChange: (model: string) => void;
};

export function ModelSelect({ model, models, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = models.find((item) => item.id === model);
  const label = current?.displayName ?? model;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`model-select-wrap ${open ? "open" : ""}`} ref={root}>
      <button
        type="button"
        className="model-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <ul id={listId} className="model-menu glass" role="listbox" aria-label="Model">
          {models.map((item) => (
            <li key={item.id} role="option" aria-selected={item.id === model}>
              <button
                type="button"
                className={item.id === model ? "active" : ""}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                {item.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
