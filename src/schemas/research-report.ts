import { z } from "zod";

export const REPORT_SECTIONS = {
  summary: "结论",
  keyPoints: "关键点",
  sources: "来源",
  uncertainties: "不确定性",
} as const;

export const REPORT_FORMAT_INSTRUCTIONS = `最终回答使用 Markdown，并且必须依次包含以下四个二级标题：

## ${REPORT_SECTIONS.summary}
一到三句话直接回答问题。

## ${REPORT_SECTIONS.keyPoints}
- 支撑结论的要点，区分事实与推断。

## ${REPORT_SECTIONS.sources}
- [标题](URL)：该来源支撑了哪个结论。没有使用来源时写“- 无”。

## ${REPORT_SECTIONS.uncertainties}
- 尚未验证的信息、来源冲突或能力限制。没有时写“- 无”。`;

/** Name of the tool `toolStrategy` derives from the schema title; the model "submits" the report by calling it. */
export const RESEARCH_REPORT_TOOL = "ResearchReport";

export const researchReportSchema = z
  .object({
    summary: z.string().describe("一到三句话直接回答问题"),
    keyPoints: z
      .array(
        z.object({
          claim: z.string().describe("支撑结论的一个要点"),
          kind: z
            .enum(["fact", "inference"])
            .describe("fact：来自工具结果或已读取的来源；inference：你的推断"),
        }),
      )
      .describe("支撑结论的要点"),
    sources: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().describe("必须是本会话实际搜索到或读取过的 URL"),
          supports: z.string().describe("该来源支撑了哪个结论"),
        }),
      )
      .describe("没有使用来源时为空数组"),
    uncertainties: z
      .array(z.string())
      .describe("尚未验证的信息、来源冲突或能力限制；没有时为空数组"),
  })
  .meta({ title: RESEARCH_REPORT_TOOL, description: "提交最终研究报告" });

export type StructuredResearchReport = z.infer<typeof researchReportSchema>;

/** Content of the ToolMessage that records a submitted report in the conversation history. */
export const REPORT_SUBMITTED_MESSAGE = "研究报告已提交。";

export const STRUCTURED_REPORT_INSTRUCTIONS = `完成研究后，调用 ${RESEARCH_REPORT_TOOL} 工具提交最终报告，不要再输出 Markdown 正文。`;

export interface ResearchReport {
  summary: string;
  keyPoints: string[];
  sourceUrls: string[];
  uncertainties: string[];
}

const URL_PATTERN = /https?:\/\/[^\s)<>\]"'`，。；：！？、]+/g;
// Markdown emphasis and sentence punctuation that commonly trail a bare URL.
const TRAILING_PUNCTUATION = /[.,;:!?*_~]+$/;

export function extractUrls(text: string): string[] {
  const urls = (text.match(URL_PATTERN) ?? []).map((url) =>
    url.replace(TRAILING_PUNCTUATION, ""),
  );
  return [...new Set(urls)];
}

function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = markdown.split(/^##\s+(.+?)\s*$/m);
  for (let index = 1; index < parts.length; index += 2) {
    sections.set(parts[index]?.trim() ?? "", (parts[index + 1] ?? "").trim());
  }
  return sections;
}

function bulletItems(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .filter((line) => line && line !== "无");
}

export function parseResearchReport(markdown: string): ResearchReport | null {
  const sections = splitSections(markdown);
  const summary = sections.get(REPORT_SECTIONS.summary);
  const keyPoints = sections.get(REPORT_SECTIONS.keyPoints);
  const sources = sections.get(REPORT_SECTIONS.sources);
  const uncertainties = sections.get(REPORT_SECTIONS.uncertainties);
  if (!summary || keyPoints === undefined || sources === undefined || uncertainties === undefined) {
    return null;
  }

  return {
    summary,
    keyPoints: bulletItems(keyPoints),
    sourceUrls: extractUrls(sources),
    uncertainties: bulletItems(uncertainties),
  };
}
