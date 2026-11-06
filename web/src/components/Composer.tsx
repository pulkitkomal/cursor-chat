import { useRef, useState } from "react";
import { SendIcon, StopIcon } from "./Icons";
import { IconButton } from "./ui/IconButton";

type Props = {
  streaming: boolean;
  disabled: boolean;
  totalTokens?: number;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function Composer({ streaming, disabled, totalTokens = 0, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const showTokens = !text.trim() && !streaming && !focused && totalTokens > 0;

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
      <div className={`composer-inner glass ${focused || text.trim() ? "focused" : ""}`}>
        {showTokens ? (
          <span className="composer-tokens" aria-hidden="true">
            {totalTokens.toLocaleString()} tokens
          </span>
        ) : null}
        <textarea
          ref={area}
          value={text}
          disabled={disabled}
          placeholder={
            disabled
              ? "Add an API key in Settings"
              : showTokens
                ? ""
                : "Message Brief"
          }
          aria-label={showTokens ? `${totalTokens.toLocaleString()} tokens used` : "Message"}
          rows={1}
          enterKeyHint="send"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
          <IconButton label="Stop" className="send stop" onClick={onStop}>
            <StopIcon width={14} height={14} />
          </IconButton>
        ) : (
          <IconButton
            label="Send"
            tone="solid"
            className="send"
            type="submit"
            disabled={disabled || !text.trim()}
          >
            <SendIcon width={14} height={14} />
          </IconButton>
        )}
      </div>
    </form>
  );
}
