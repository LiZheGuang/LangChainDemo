import { Box, Text, useAnimation, useInput } from "ink";
import { useState, type ReactNode } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label?: string }) {
  const { frame } = useAnimation({ interval: 80 });
  return (
    <Text color="cyan">
      {FRAMES[frame % FRAMES.length]}
      {label ? <Text dimColor> {label}</Text> : null}
    </Text>
  );
}

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

/** Arrow keys or number keys pick an option; Enter always fires, even for the current value. */
export function Picker({
  title,
  options,
  initialValue,
  onSelect,
  onCancel,
  children,
}: {
  title: string;
  options: PickerOption[];
  initialValue?: string;
  onSelect: (value: string) => void;
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === initialValue)),
  );
  useInput((input, key) => {
    if (key.upArrow) setIndex((current) => (current - 1 + options.length) % options.length);
    else if (key.downArrow) setIndex((current) => (current + 1) % options.length);
    else if (key.return) {
      const option = options[index];
      if (option) onSelect(option.value);
    } else if (key.escape) onCancel?.();
    else if (/^[1-9]$/.test(input)) {
      const option = options[Number(input) - 1];
      if (option) onSelect(option.value);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        {title}
      </Text>
      {children}
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, position) => {
          const active = position === index;
          return (
            <Text key={option.value} color={active ? "magenta" : undefined} bold={active}>
              {active ? "❯ " : "  "}
              <Text dimColor={!active}>{position < 9 ? `${position + 1} ` : "  "}</Text>
              {option.label}
              {option.hint ? <Text dimColor>  {option.hint}</Text> : null}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>↑↓ 移动 · Enter 确认 · 数字键直选{onCancel ? " · Esc 取消" : ""}</Text>
    </Box>
  );
}

export interface CommandInfo {
  name: string;
  description: string;
}

/**
 * Single-line input. Typing "/" lists matching commands, which ↑↓ and Enter can
 * pick so a command never has to be typed out in full.
 */
export function Composer({
  isActive,
  commands,
  onSubmit,
}: {
  isActive: boolean;
  commands: CommandInfo[];
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const matches =
    value.startsWith("/") && !value.includes(" ")
      ? commands.filter((command) => command.name.startsWith(value))
      : [];

  useInput(
    (input, key) => {
      if (key.return) {
        const picked = matches[Math.min(highlight, matches.length - 1)];
        const text = picked ? picked.name : value.trim();
        setValue("");
        setHighlight(0);
        if (text) onSubmit(text);
        return;
      }
      if (matches.length > 0 && (key.upArrow || key.downArrow)) {
        const step = key.upArrow ? -1 : 1;
        setHighlight((current) => (current + step + matches.length) % matches.length);
        return;
      }
      if (key.backspace || key.delete) {
        setValue((current) => Array.from(current).slice(0, -1).join(""));
        setHighlight(0);
        return;
      }
      if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow) return;
      if (key.leftArrow || key.rightArrow) return;
      setValue((current) => current + input.replace(/[\r\n]+/g, " "));
      setHighlight(0);
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={isActive ? "cyan" : "gray"} paddingX={1}>
        <Text color={isActive ? "cyan" : "gray"}>› </Text>
        <Text>{value}</Text>
        {isActive ? <Text inverse> </Text> : null}
        {!value ? <Text dimColor>{isActive ? " 输入问题，或输入 / 选择命令" : "等待回答…"}</Text> : null}
      </Box>
      {matches.map((command, position) => {
        const active = position === Math.min(highlight, matches.length - 1);
        return (
          <Text key={command.name} color={active ? "cyan" : undefined}>
            {active ? " ❯ " : "   "}
            {command.name.padEnd(10)}
            <Text dimColor>{command.description}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
