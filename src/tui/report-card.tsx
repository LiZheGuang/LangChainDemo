import { Box, Text } from "ink";
import type { ReactNode } from "react";

const KINDS = {
  fact: { label: "事实", color: "green" },
  inference: { label: "推断", color: "yellow" },
} as const;

function field(item: unknown, key: string): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function KeyPoint({ item }: { item: unknown }) {
  const kind = field(item, "kind");
  const tag = kind === "fact" || kind === "inference" ? KINDS[kind] : undefined;
  return (
    <Box>
      <Text color={tag?.color ?? "gray"}>{tag ? `[${tag.label}] ` : "[ … ] "}</Text>
      <Box flexShrink={1}>
        <Text>{field(item, "claim") ?? ""}</Text>
      </Box>
    </Box>
  );
}

function SourceItem({ item, index }: { item: unknown; index: number }) {
  const url = field(item, "url");
  const supports = field(item, "supports");
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">{index + 1}. </Text>
        {field(item, "title") ?? ""}
      </Text>
      {url ? (
        <Box paddingLeft={3}>
          <Text color="blue" underline>
            {url}
          </Text>
        </Box>
      ) : null}
      {supports ? (
        <Box paddingLeft={3}>
          <Text dimColor>支撑：{supports}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Renders a report that may still be streaming: sections appear as their
 * fields arrive, and a list only reads "无" once the report is complete.
 */
export function ReportCard({ report, complete, retry }: { report: object; complete: boolean; retry: boolean }) {
  const { summary, keyPoints, sources, uncertainties } = report as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : undefined);
  const shown = (items: unknown[] | undefined): items is unknown[] =>
    items !== undefined && (items.length > 0 || complete);
  const none = <Text dimColor>无</Text>;
  const points = list(keyPoints);
  const cited = list(sources);
  const doubts = list(uncertainties);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={complete ? "green" : "gray"} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>研究报告</Text>
        <Text dimColor>
          {retry ? "重新提交 · " : ""}
          {complete ? "已完成" : "撰写中…"}
        </Text>
      </Box>
      {typeof summary === "string" ? (
        <Section title="结论">
          <Text>{summary}</Text>
        </Section>
      ) : null}
      {shown(points) ? (
        <Section title="关键点">
          {points.length ? points.map((item, index) => <KeyPoint key={index} item={item} />) : none}
        </Section>
      ) : null}
      {shown(cited) ? (
        <Section title="来源">
          {cited.length ? cited.map((item, index) => <SourceItem key={index} item={item} index={index} />) : none}
        </Section>
      ) : null}
      {shown(doubts) ? (
        <Section title="不确定性">
          {doubts.length
            ? doubts.map((item, index) => (
                <Text key={index}>
                  <Text color="yellow">• </Text>
                  {typeof item === "string" ? item : ""}
                </Text>
              ))
            : none}
        </Section>
      ) : null}
    </Box>
  );
}
