import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { diagnoseModel, listModelIds, modelConfig } from "./config/model.js";
import { LiveReport, renderReport } from "./report-view.js";
import { createResearchSession, preview } from "./session/research-session.js";

const HELP = `命令：
  /help       查看帮助
  /new        开始新会话
  /history    查看当前会话消息
  /sources    查看当前会话收集的来源
  /model      查看可选模型；/model <名称> 切换模型，当前会话保留
  /exit       退出`;

/** Line-based fallback for piped input and terminals without raw mode. */
export async function runPlainCli(): Promise<void> {
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
  const write = (chunk: string) => process.stdout.write(chunk);
  const session = createResearchSession();
  let threadId = randomUUID();
  let modelId = listModelIds()[0] ?? "";

  console.log("LangChain 开发者研究助手");
  console.log(HELP);
  console.log(`\n模型检查：${(await diagnoseModel()).message}\n`);
  await session.trace.write({ type: "session_start", threadId });

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
        await session.trace.write({ type: "session_start", threadId });
        console.log("已开始新会话。");
        continue;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const ids = listModelIds();
        const requested = text.slice("/model".length).trim();
        if (!requested) {
          console.log(ids.map((id) => `${id === modelId ? "*" : " "} ${id}`).join("\n"));
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
        const { sources } = await session.readThread(threadId);
        console.log(
          sources.length
            ? sources.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`).join("\n")
            : "当前会话还没有来源。",
        );
        continue;
      }
      if (text === "/history") {
        const { messages } = await session.readThread(threadId);
        console.log(
          messages.length
            ? messages
                .map((message) => {
                  const calls = ("tool_calls" in message && Array.isArray(message.tool_calls)
                    ? (message.tool_calls as Array<{ name: string; args: unknown }>)
                    : []
                  )
                    .map((call) => ` → 调用 ${call.name} ${JSON.stringify(call.args)}`)
                    .join("");
                  return `[${message.getType()}] ${preview(message.text, 200)}${calls}`;
                })
                .join("\n")
            : "当前会话还没有消息。",
        );
        continue;
      }

      let streamedText = false;
      let wroteText = false;
      let live: { attempt: number; view: LiveReport } | undefined;
      try {
        const result = await session.runTurn(
          { text, threadId, model: modelId },
          {
            onEvent: (event) => {
              if (event.type === "text") {
                if (event.startsBlock) write(streamedText ? "\n" : "\n助手 > ");
                streamedText = true;
                wroteText = true;
                write(event.text);
              } else if (event.type === "report") {
                if (live?.attempt !== event.attempt) {
                  write(live ? "\n\n（上一份报告未通过校验，模型重新提交）\n" : "\n助手 >\n");
                  live = { attempt: event.attempt, view: new LiveReport(write) };
                }
                live.view.update(event.report, event.complete);
              } else if (event.type === "tool-start") {
                console.log(`\n  [工具] ${event.name} ${JSON.stringify(event.input)}`);
              } else {
                console.log(`  ${event.ok ? "[结果]" : "[失败]"} ${event.detail}`);
              }
            },
            approve: async (actions) => {
              if (wroteText || live) write("\n");
              const details = actions
                .map((action) => `${action.name} ${JSON.stringify(action.args)}`)
                .join("\n");
              console.log(`待审批操作：\n${details || "外部网络请求"}`);
              const answer = (await ask("允许执行？输入 y 批准，其余拒绝 > "))?.toLowerCase() ?? "";
              return answer === "y" || answer === "yes";
            },
          },
        );
        if (wroteText || live) write("\n");
        if (result.report && !live) {
          console.log(`\n助手 >\n${renderReport(result.report, true)}`);
        } else if (!result.report && !streamedText) {
          console.log(`\n助手 > ${result.answer || "（模型没有返回内容）"}`);
        }
        if (result.unverifiedUrls.length > 0) {
          console.log(
            `\n注意：以下链接没有经过本次会话的搜索或网页读取验证：\n${result.unverifiedUrls
              .map((url) => `- ${url}`)
              .join("\n")}`,
          );
        }
        console.log();
      } catch (error) {
        console.error(`执行失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    terminal.close();
  }
}
