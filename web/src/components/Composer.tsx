import { useState, type KeyboardEvent } from "react";

interface ComposerProps {
  disabled: boolean;
  isLoading: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ disabled, isLoading, placeholder, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");

  const send = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <textarea
        value={text}
        rows={2}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {isLoading ? (
        <button type="button" onClick={onStop}>
          停止
        </button>
      ) : (
        <button type="button" className="primary" disabled={disabled || !text.trim()} onClick={send}>
          发送
        </button>
      )}
    </div>
  );
}
