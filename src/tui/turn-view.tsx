import { Box, Text } from "ink";
import { preview } from "../session/research-session.js";
import { ReportCard } from "./report-card.js";
import type { TurnBlock, TurnState } from "./turn-state.js";
import { Spinner } from "./widgets.js";

const TOOL_LABELS: Record<string, string> = {
  calculator: "计算",
  current_time: "当前时间",
  web_search: "搜索",
  fetch_page: "读取网页",
};

function Block({ block }: { block: TurnBlock }) {
  switch (block.kind) {
    case "text":
      return <Text>{block.text}</Text>;
    case "report":
      return <ReportCard report={block.report} complete={block.complete} retry={block.attempt > 0} />;
    case "tool":
      return (
        <Box flexDirection="column">
          <Text>
            {block.status === "running" ? <Spinner /> : null}
            {block.status === "ok" ? <Text color="green">✓</Text> : null}
            {block.status === "error" ? <Text color="red">✗</Text> : null}
            <Text bold> {TOOL_LABELS[block.name] ?? block.name}</Text>
            <Text dimColor> {preview(block.input, 80)}</Text>
          </Text>
          {block.detail ? (
            <Box paddingLeft={2}>
              <Text color={block.status === "error" ? "red" : "gray"}>└ {preview(block.detail, 120)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    case "approval":
      return (
        <Text color={block.approved ? "green" : "red"}>
          {block.approved ? "✓ 已批准 " : "✗ 已拒绝 "}
          <Text dimColor>{block.actions.map((action) => `${action.name} ${preview(action.args, 60)}`).join("；")}</Text>
        </Text>
      );
  }
}

function activity(turn: TurnState): string {
  const last = turn.blocks.at(-1);
  if (last?.kind === "report" && !last.complete) return "正在撰写报告";
  if (last?.kind === "tool" && last.status === "running") return "正在调用工具";
  return "思考中";
}

export function TurnView({ turn, awaitingApproval = false }: { turn: TurnState; awaitingApproval?: boolean }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>
          ›{" "}
        </Text>
        <Box flexShrink={1}>
          <Text bold>{turn.question}</Text>
        </Box>
        <Text dimColor>  {turn.model}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2} marginTop={1} gap={1}>
        {turn.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
        {turn.status === "running" && !awaitingApproval ? <Spinner label={`${activity(turn)}…`} /> : null}
        {turn.unverifiedUrls.length > 0 ? (
          <Box flexDirection="column">
            <Text color="yellow">⚠ 以下链接没有经过本次会话的搜索或网页读取验证：</Text>
            {turn.unverifiedUrls.map((url) => (
              <Text key={url} color="yellow">
                {"  "}- {url}
              </Text>
            ))}
          </Box>
        ) : null}
        {turn.error ? <Text color="red">✗ 执行失败：{turn.error}</Text> : null}
      </Box>
    </Box>
  );
}
