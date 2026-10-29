#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createStructuredResearchAgent } from "./agent/create-research-agent.js";
import type { Source } from "./agent/sources-state.js";
import { diagnoseModel, listModelIds, modelConfig } from "./config/model.js";
import { findUnverifiedUrls } from "./evaluation/evaluate-report.js";
import { TraceWriter } from "./observability/trace.js";
import { LiveReport, renderReport, reportText } from "./report-view.js";
import {
  REPORT_SUBMITTED_MESSAGE,
  RESEARCH_REPORT_TOOL,
  type StructuredResearchReport,
} from "./schemas/research-report.js";

const HELP = `命令：
  /help       查看帮助
  /new        开始新会话
  /history    查看当前会话消息
  /sources    查看当前会话收集的来源
  /model      查看可选模型；/model <名称> 切换模型，当前会话保留
  /exit       退出`;

function preview(value: unknown, maxLength = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const singleLine = text.replace(/\s+/g, " ");
  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength)}…`
    : singleLine;
}

function countApprovalActions(interrupts: unknown[]): number {
  const first = interrupts[0] as
    | { payload?: { actionRequests?: unknown[] }; value?: { actionRequests?: unknown[] } }
    | undefined;
  return (
    first?.payload?.actionRequests?.length ??
    first?.value?.actionRequests?.length ??
    1
  );
}

function summarizeApproval(interrupts: unknown[]): string {
  const first = interrupts[0] as
    | {
        payload?: { actionRequests?: Array<{ name?: string; args?: unknown }> };
        value?: { actionRequests?: Array<{ name?: string; args?: unknown }> };
      }
    | undefined;
  const actions =
    first?.payload?.actionRequests ?? first?.value?.actionRequests ?? [];
  return actions
    .map(
      (action) =>
        `${action.name ?? "未知工具"} ${JSON.stringify(action.args ?? {})}`,
    )
    .join("\n");
}

export async function runCli(): Promise<void> {
  const terminal = createInterface({ input, output });
  let inputClosed = false;
  terminal.once("close", () => {
    inputClosed = true;
  });
  const ask = async (prompt: string): Promise<string | null> => {
    if (inputClosed) return null;
    try {
      return (await terminal.question(prompt)).trim();
    } catch (error) {
      if (inputClosed) return null;
      throw error;
    }
  };
  const trace = new TraceWriter();
  const checkpointer = new MemorySaver();
  const agent = createStructuredResearchAgent({ checkpointer });
  let threadId = randomUUID();
  let modelId = listModelIds()[0] ?? "";
  const readThread = async () => {
    const saved = await checkpointer.get({ configurable: { thread_id: threadId } });
    return {
      messages: (saved?.channel_values.messages ?? []) as BaseMessage[],
      sources: (saved?.channel_values.sources ?? []) as Source[],
    };
  };

  console.log("LangChain 开发者研究助手");
  console.log(HELP);
  const diagnostic = await diagnoseModel();
  console.log(`\n模型检查：${diagnostic.message}\n`);
  await trace.write({ type: "session_start", threadId });

  try {
    while (true) {
      const text = await ask("你 > ");
      if (text === null || text === "/exit") break;
      if (!text) continue;
      if (text === "/help") {
        console.log(HELP);
        continue;
      }
      if (text === "/new") {
        threadId = randomUUID();
        await trace.write({ type: "session_start", threadId });
        console.log("已开始新会话。");
        continue;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const ids = listModelIds();
        const requested = text.slice("/model".length).trim();
        if (!requested) {
          console.log(ids.map((id) => `${id === modelId ? "*" : " "} ${id}`).join("\n"));
          if (ids.length === 1) {
            console.log("在 .env 的 MODEL_OPTIONS 中添加更多模型，例如 MODEL_OPTIONS=ollama:qwen3:4b");
          }
          continue;
        }
        if (!ids.includes(requested)) {
          console.log(`未配置的模型：${requested}。可选：${ids.join(", ")}`);
          continue;
        }
        modelId = requested;
        const check = await diagnoseModel(modelConfig(modelId));
        console.log(`已切换到 ${modelId}，当前会话保留。模型检查：${check.message}`);
        continue;
      }
      if (text === "/sources") {
        const items = (await readThread()).sources;
        console.log(
          items.length
            ? items
                .map((source, index) => `${index + 1}. ${source.title} — ${source.url}`)
                .join("\n")
            : "当前会话还没有来源。",
        );
        continue;
      }
      if (text === "/history") {
        const { messages } = await readThread();
        console.log(
          messages.length
            ? messages
                .map((message) => {
                  const toolCalls =
                    "tool_calls" in message && Array.isArray(message.tool_calls)
                      ? (message.tool_calls as Array<{ name: string; args: unknown }>)
                      : [];
                  const calls = toolCalls
                    .map((call) => ` → 调用 ${call.name} ${JSON.stringify(call.args)}`)
                    .join("");
                  return `[${message.getType()}] ${preview(message.text, 200)}${calls}`;
                })
                .join("\n")
            : "当前会话还没有消息。",
        );
        continue;
      }

      await trace.write({
        type: "user_message",
        threadId,
        data: { content: text, model: modelId },
      });
      const config = {
        configurable: { thread_id: threadId },
        context: { model: modelId },
        recursionLimit: 20,
      };
      let nextInput: Parameters<typeof agent.streamEvents>[0] = {
        messages: [{ role: "user", content: text }],
      };

      let streamedAnswer = false;
      let streamedReport = false;
      const write = (chunk: string) => process.stdout.write(chunk);
      try {
        while (true) {
          const stream = await agent.streamEvents(nextInput, {
            ...config,
            version: "v3",
          });
          const printAnswer = async () => {
            for await (const message of stream.messages) {
              let wroteText = false;
              // The report arrives as tool-call arguments, keyed by content block index.
              const reports = new Map<number, LiveReport>();
              for await (const event of message) {
                if (event.event === "content-block-start") {
                  const block = event.content;
                  if (block.type === "tool_call_chunk" && block.name === RESEARCH_REPORT_TOOL) {
                    write(streamedReport ? "\n\n（上一份报告未通过校验，模型重新提交）\n" : "\n助手 >\n");
                    streamedReport = true;
                    reports.set(event.index, new LiveReport(write));
                  }
                } else if (event.event === "content-block-delta") {
                  const { delta } = event;
                  if (delta.type === "tool-call-delta") {
                    reports.get(event.index)?.push(delta.args);
                  } else if (delta.type === "text-delta") {
                    // The report-submitted ToolMessage is replayed on this stream as one chunk.
                    if (!wroteText && delta.text === REPORT_SUBMITTED_MESSAGE) break;
                    // glm can emit stray whitespace text next to the report tool call.
                    if (!wroteText && !delta.text.trim()) continue;
                    if (!wroteText) {
                      write(streamedAnswer ? "\n" : "\n助手 > ");
                      wroteText = true;
                    }
                    streamedAnswer = true;
                    write(delta.text);
                  }
                } else if (event.event === "content-block-finish") {
                  const block = event.content;
                  if (block.type === "tool_call") reports.get(event.index)?.finish(block.args);
                }
              }
              if (wroteText || reports.size > 0) write("\n");
            }
          };
          const printToolCalls = async () => {
            for await (const call of stream.toolCalls) {
              console.log(`\n  [工具] ${call.name} ${JSON.stringify(call.input)}`);
              await trace.write({
                type: "tool_call",
                threadId,
                data: { name: call.name, input: call.input as unknown },
              });
              // A gated call may never settle in this run, so its result must not block the loop.
              void call.status.then(async (status) => {
                const detail =
                  status === "error"
                    ? `[失败] ${(await call.error) ?? "未知错误"}`
                    : `[结果] ${preview(await call.output)}`;
                console.log(`  ${detail}`);
              });
            }
          };
          await Promise.all([printAnswer(), printToolCalls()]);

          if (stream.interrupted) {
            const interrupts = stream.interrupts as unknown[];
            const details = summarizeApproval(interrupts);
            console.log(`待审批操作：\n${details || "外部网络请求"}`);
            const answer =
              (await ask("允许执行？输入 y 批准，其余拒绝 > "))?.toLowerCase() ?? "";
            const type = answer === "y" || answer === "yes" ? "approve" : "reject";
            nextInput = new Command({
              resume: {
                decisions: Array.from(
                  { length: countApprovalActions(interrupts) },
                  () =>
                    type === "approve"
                      ? { type }
                      : { type, message: "用户拒绝了该外部请求。" },
                ),
              },
            });
            continue;
          }

          const result = (await stream.output) as {
            messages?: BaseMessage[];
            sources?: Source[];
            structuredResponse?: StructuredResearchReport;
          };
          const report = result.structuredResponse;
          const answer = result.messages?.at(-1)?.text ?? "";
          if (report) {
            if (!streamedReport) console.log(`\n助手 >\n${renderReport(report, true)}`);
          } else if (!streamedAnswer) {
            console.log(`\n助手 > ${answer || "（模型没有返回内容）"}`);
          }

          const unverifiedUrls = findUnverifiedUrls(
            report ? reportText(report) : answer,
            (result.sources ?? []).map((source) => source.url),
          );
          if (unverifiedUrls.length > 0) {
            console.log(
              `\n注意：以下链接没有经过本次会话的搜索或网页读取验证：\n${unverifiedUrls
                .map((url) => `- ${url}`)
                .join("\n")}`,
            );
          }
          console.log();
          await trace.write({
            type: "assistant_message",
            threadId,
            data: report ? { report, unverifiedUrls } : { answer, unverifiedUrls },
          });
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`执行失败：${message}`);
        await trace.write({
          type: "error",
          threadId,
          data: { message },
        });
      }
    }
  } finally {
    terminal.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli();
}
