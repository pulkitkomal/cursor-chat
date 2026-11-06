import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, hint, children, className = "" }: FieldProps) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput(props: InputProps) {
  return <input className="field-control" {...props} />;
}

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea(props: AreaProps) {
  return <textarea className="field-control" {...props} />;
}
