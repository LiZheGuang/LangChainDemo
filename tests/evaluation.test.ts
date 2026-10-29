import { describe, expect, it } from "vitest";
import {
  evaluateReport,
  findUnverifiedUrls,
} from "../src/evaluation/evaluate-report.js";
import {
  extractUrls,
  parseResearchReport,
} from "../src/schemas/research-report.js";

const toolsUrl = "https://docs.langchain.com/oss/javascript/langchain/tools";

const sourcedAnswer = `## 结论
LangChain tool 使用 Zod schema 描述输入。

## 关键点
- Agent 根据上下文选择 tool。
- 工具返回值会作为 ToolMessage 交回模型。

## 来源
- [LangChain Tools](${toolsUrl})：解释工具定义。

## 不确定性
- 无`;

describe("parseResearchReport", () => {
  it("extracts the four sections from Markdown", () => {
    expect(parseResearchReport(sourcedAnswer)).toEqual({
      summary: "LangChain tool 使用 Zod schema 描述输入。",
      keyPoints: ["Agent 根据上下文选择 tool。", "工具返回值会作为 ToolMessage 交回模型。"],
      sourceUrls: [toolsUrl],
      uncertainties: [],
    });
  });

  it("does not swallow Markdown code, emphasis or punctuation around URLs", () => {
    expect(
      extractUrls("访问 `https://example.com`，以及 **https://a.dev/x**. 还有 https://b.dev/y。"),
    ).toEqual(["https://example.com", "https://a.dev/x", "https://b.dev/y"]);
  });

  it("returns null when required sections are missing", () => {
    expect(parseResearchReport("LangChain 是一个框架。")).toBeNull();
  });
});

describe("evaluateReport", () => {
  const testCase = {
    name: "tools-basics",
    expectedTerms: ["Zod", "Agent"],
    requiresSources: true,
  };

  it("passes a well-formed answer whose citations were actually fetched", () => {
    const result = evaluateReport(sourcedAnswer, testCase, [toolsUrl]);
    expect(result.passed).toBe(true);
  });

  it("flags citations that no tool ever touched", () => {
    const result = evaluateReport(sourcedAnswer, testCase, []);
    expect(result.checks.citationsVerified).toBe(false);
    expect(result.unverifiedUrls).toEqual([toolsUrl]);
    expect(result.passed).toBe(false);
  });

  it("treats trailing slashes and fragments as the same fetched URL", () => {
    expect(findUnverifiedUrls("见 https://example.com 与 https://a.dev/x#y", [
      "https://example.com/",
      "https://a.dev/x",
    ])).toEqual([]);
  });

  it("fails missing evidence when sources are required", () => {
    const result = evaluateReport(
      sourcedAnswer.replace(`- [LangChain Tools](${toolsUrl})：解释工具定义。`, "- 无"),
      testCase,
    );
    expect(result.checks.format).toBe(true);
    expect(result.checks.sources).toBe(false);
    expect(result.passed).toBe(false);
  });
});
