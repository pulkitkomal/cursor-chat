import type { ModelOption } from "../types";

type Props = {
  model: string;
  models: ModelOption[];
  disabled?: boolean;
  onChange: (model: string) => void;
};

export function ModelSelect({ model, models, disabled, onChange }: Props) {
  const current = models.find((item) => item.id === model);

  return (
    <label className="model-select-wrap">
      <span className="visually-hidden">Model</span>
      <select
        className="model-select"
        value={model}
        disabled={disabled}
        aria-label="Model"
        onChange={(event) => onChange(event.target.value)}
      >
        {current ? null : <option value={model}>{model}</option>}
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
