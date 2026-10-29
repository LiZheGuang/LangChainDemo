import { describe, expect, it } from "vitest";
import { LiveReport, renderReport } from "../src/report-view.js";

const report = {
  keyPoints: [
    { claim: "闭包让函数记住定义时的词法作用域", kind: "fact" },
    { claim: "常用于封装私有状态", kind: "inference" },
  ],
  sources: [],
  summary: "闭包是函数与其词法环境的组合。",
  uncertainties: ["未查阅规范原文"],
};

const expected = [
  "关键点：",
  "  - 闭包让函数记住定义时的词法作用域（事实）",
  "  - 常用于封装私有状态（推断）",
  "来源：无",
  "结论：闭包是函数与其词法环境的组合。",
  "不确定性：",
  "  - 未查阅规范原文",
].join("\n");

describe("renderReport", () => {
  it("renders sections in arrival order", () => {
    expect(renderReport(report, true)).toBe(expected);
  });

  it("hides a truncated enum value and a trailing empty list that may still grow", () => {
    expect(renderReport({ keyPoints: [{ claim: "要点", kind: "fa" }] }, false)).toBe(
      "关键点：\n  - 要点",
    );
    expect(renderReport({ sources: [] }, false)).toBe("");
    expect(renderReport({ sources: [] }, true)).toBe("来源：无");
  });

  it("numbers sources and shows what each one supports", () => {
    const text = renderReport(
      { sources: [{ title: "MDN", url: "https://developer.mozilla.org", supports: "定义" }] },
      true,
    );
    expect(text).toBe("来源：\n  1. MDN — https://developer.mozilla.org\n     支撑：定义");
  });
});

describe("LiveReport", () => {
  it("only appends while arguments stream in character by character", () => {
    const chunks: string[] = [];
    const live = new LiveReport((chunk) => chunks.push(chunk));
    for (const char of JSON.stringify(report)) live.push(char);
    live.finish(report);

    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.join("")).toBe(expected);
  });

  it("reprints the report when the final arguments disagree with the streamed prefix", () => {
    const chunks: string[] = [];
    const live = new LiveReport((chunk) => chunks.push(chunk));
    live.push('{"summary":"旧结论"');
    live.finish({ summary: "新结论" });

    expect(chunks.join("")).toBe("结论：旧结论\n结论：新结论");
  });
});
