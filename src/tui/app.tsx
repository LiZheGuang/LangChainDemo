import { randomUUID } from "node:crypto";
import { Box, Static, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ModelDiagnostic } from "../config/model.js";
import { preview, type ApprovalAction, type ResearchSession } from "../session/research-session.js";
import {
  applyEvent,
  failTurn,
  finishTurn,
  recordApproval,
  startTurn,
  type TurnState,
} from "./turn-state.js";
import { TurnView } from "./turn-view.js";
import { Composer, Picker, type CommandInfo } from "./widgets.js";

export const COMMANDS: CommandInfo[] = [
  { name: "/model", description: "选择模型（Ctrl+P）" },
  { name: "/new", description: "开始新会话（Ctrl+N）" },
  { name: "/history", description: "查看当前会话消息" },
  { name: "/sources", description: "查看当前会话收集的来源" },
  { name: "/help", description: "查看命令与快捷键" },
  { name: "/exit", description: "退出（Ctrl+C）" },
];

type Entry =
  | { id: number; kind: "banner" }
  | { id: number; kind: "turn"; turn: TurnState }
  | { id: number; kind: "notice"; tone: "info" | "success" | "error"; text: string }
  | { id: number; kind: "panel"; title: string; lines: string[] };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id"> : never) : never;

const TONE_COLORS = { info: "gray", success: "green", error: "red" } as const;

function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "banner":
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} marginBottom={1}>
          <Text bold color="cyan">
            ◆ LangChain 开发者研究助手
          </Text>
          <Text dimColor>结构化研究报告 · 工具调用审批 · 来源核验 · 随时切换模型</Text>
        </Box>
      );
    case "turn":
      return <TurnView turn={entry.turn} />;
    case "notice":
      return (
        <Box marginBottom={1}>
          <Text color={TONE_COLORS[entry.tone]}>{entry.text}</Text>
        </Box>
      );
    case "panel":
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
          <Text bold>{entry.title}</Text>
          {entry.lines.map((line, index) => (
            <Text key={index} dimColor={line.startsWith("  ")}>
              {line}
            </Text>
          ))}
        </Box>
      );
  }
}

type Health = "checking" | ModelDiagnostic;

function StatusBar({ model, health, threadId }: { model: string; health: Health; threadId: string }) {
  const color = health === "checking" ? "yellow" : health.ok ? "green" : "red";
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text color={color}>● </Text>
          <Text bold>{model}</Text>
          <Text dimColor>  会话 {threadId.slice(0, 8)}</Text>
        </Text>
        <Text dimColor>Ctrl+P 模型 · Ctrl+N 新会话 · / 命令 · Ctrl+C 退出</Text>
      </Box>
      {health !== "checking" && !health.ok ? <Text color="red">{health.message}</Text> : null}
    </Box>
  );
}

export interface AppProps {
  session: Pick<ResearchSession, "runTurn" | "readThread" | "trace">;
  models: string[];
  diagnose: (model: string) => Promise<ModelDiagnostic>;
  createThreadId?: () => string;
}

export function App({ session, models, diagnose, createThreadId = randomUUID }: AppProps) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, kind: "banner" }]);
  const nextId = useRef(1);
  const [threadId, setThreadId] = useState(createThreadId);
  const [model, setModel] = useState(models[0] ?? "");
  const [health, setHealth] = useState<Health>("checking");
  const latestCheck = useRef("");
  const [picking, setPicking] = useState(false);
  const [turn, setTurn] = useState<TurnState | null>(null);
  const turnRef = useRef<TurnState | null>(null);
  const [approval, setApproval] = useState<{
    actions: ApprovalAction[];
    decide: (approved: boolean) => void;
  } | null>(null);

  const push = (entry: NewEntry) =>
    setEntries((list) => [...list, { ...entry, id: nextId.current++ }]);

  const updateTurn = (update: (current: TurnState) => TurnState) => {
    if (!turnRef.current) return;
    turnRef.current = update(turnRef.current);
    setTurn(turnRef.current);
  };

  const checkModel = (id: string) => {
    latestCheck.current = id;
    setHealth("checking");
    void diagnose(id).then((result) => {
      if (latestCheck.current === id) setHealth(result);
    });
  };

  useEffect(() => {
    checkModel(model);
    void session.trace.write({ type: "session_start", threadId });
    // Runs once on mount; later checks are triggered by model switches.
  }, []);

  const newThread = () => {
    const id = createThreadId();
    setThreadId(id);
    void session.trace.write({ type: "session_start", threadId: id });
    push({ kind: "notice", tone: "success", text: `已开始新会话 ${id.slice(0, 8)}` });
  };

  const selectModel = (id: string) => {
    setPicking(false);
    if (id === model) return;
    setModel(id);
    push({ kind: "notice", tone: "success", text: `已切换到 ${id}，当前会话保留` });
    checkModel(id);
  };

  const ask = async (question: string) => {
    turnRef.current = startTurn(question, model);
    setTurn(turnRef.current);
    try {
      const result = await session.runTurn(
        { text: question, threadId, model },
        {
          onEvent: (event) => updateTurn((current) => applyEvent(current, event)),
          approve: (actions) =>
            new Promise<boolean>((resolve) => {
              setApproval({
                actions,
                decide: (approved) => {
                  setApproval(null);
                  updateTurn((current) => recordApproval(current, actions, approved));
                  resolve(approved);
                },
              });
            }),
        },
      );
      updateTurn((current) => finishTurn(current, result));
    } catch (error) {
      updateTurn((current) => failTurn(current, error));
    }
    const finished = turnRef.current;
    turnRef.current = null;
    setTurn(null);
    if (finished) push({ kind: "turn", turn: finished });
  };

  const runCommand = async (name: string) => {
    switch (name) {
      case "/model":
        setPicking(true);
        return;
      case "/new":
        newThread();
        return;
      case "/exit":
        exit();
        return;
      case "/help":
        push({
          kind: "panel",
          title: "命令与快捷键",
          lines: [
            ...COMMANDS.map((command) => `${command.name.padEnd(10)} ${command.description}`),
            "  输入 / 后可用 ↑↓ 选择命令，Enter 执行",
          ],
        });
        return;
      case "/sources": {
        const { sources } = await session.readThread(threadId);
        push({
          kind: "panel",
          title: "当前会话来源",
          lines: sources.length
            ? sources.flatMap((source, index) => [`${index + 1}. ${source.title}`, `   ${source.url}`])
            : ["  当前会话还没有来源。"],
        });
        return;
      }
      case "/history": {
        const { messages } = await session.readThread(threadId);
        push({
          kind: "panel",
          title: "当前会话消息",
          lines: messages.length
            ? messages.map((message) => {
                const calls =
                  "tool_calls" in message && Array.isArray(message.tool_calls)
                    ? (message.tool_calls as Array<{ name: string }>).map((call) => ` → 调用 ${call.name}`).join("")
                    : "";
                return `[${message.getType()}] ${preview(message.text, 100)}${calls}`;
              })
            : ["  当前会话还没有消息。"],
        });
        return;
      }
      default:
        push({ kind: "notice", tone: "error", text: `未知命令 ${name}，输入 / 查看可用命令` });
    }
  };

  const idle = !turn && !picking;
  useInput(
    (input, key) => {
      if (key.ctrl && input === "p") setPicking(true);
      else if (key.ctrl && input === "n") newThread();
    },
    { isActive: idle },
  );

  const submit = (text: string) => {
    if (text.startsWith("/")) void runCommand(text.split(/\s+/)[0] ?? text);
    else void ask(text);
  };

  return (
    <>
      {/* Static output is absolutely positioned, so it needs an explicit width to wrap like the live area. */}
      <Static items={entries} style={{ width: columns }}>
        {(entry) => <EntryView key={entry.id} entry={entry} />}
      </Static>
      {turn ? <TurnView turn={turn} awaitingApproval={approval !== null} /> : null}
      {approval ? (
        <Picker
          title="允许执行外部请求？"
          options={[
            { value: "approve", label: "批准", hint: "执行下列请求" },
            { value: "reject", label: "拒绝", hint: "模型会改用已有信息作答" },
          ]}
          onSelect={(value) => approval.decide(value === "approve")}
        >
          {approval.actions.map((action, index) => (
            <Text key={index} dimColor>
              {action.name} {preview(action.args, 100)}
            </Text>
          ))}
        </Picker>
      ) : null}
      {picking ? (
        <Picker
          title="选择模型"
          options={models.map((id) => ({ value: id, label: id, hint: id === model ? "当前" : undefined }))}
          initialValue={model}
          onSelect={selectModel}
          onCancel={() => setPicking(false)}
        >
          <Text dimColor>切换后当前会话的历史会保留</Text>
        </Picker>
      ) : null}
      <Composer isActive={idle} commands={COMMANDS} onSubmit={submit} />
      <StatusBar model={model} health={health} threadId={threadId} />
    </>
  );
}
