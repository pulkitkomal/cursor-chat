import { useRef, useState } from "react";
import { SendIcon, StopIcon } from "./Icons";

type Props = {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function Composer({ streaming, disabled, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const next = text.trim();
    if (!next || streaming || disabled) return;
    onSend(next);
    setText("");
    if (area.current) area.current.style.height = "auto";
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="composer-inner">
        <textarea
          ref={area}
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Add an API key in Settings" : "Message"}
          rows={1}
          enterKeyHint="send"
          onChange={(event) => {
            setText(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="send stop" onClick={onStop} aria-label="Stop">
            <StopIcon width={16} height={16} />
          </button>
        ) : (
          <button
            type="submit"
            className="send"
            disabled={disabled || !text.trim()}
            aria-label="Send"
          >
            <SendIcon width={16} height={16} />
          </button>
        )}
      </div>
    </form>
  );
}
