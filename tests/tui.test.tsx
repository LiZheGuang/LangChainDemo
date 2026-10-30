import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppProps } from "../src/tui/app.js";
import { App } from "../src/tui/app.js";

const DOWN = "\u001B[B";
const ENTER = "\r";
const CTRL_P = "\u0010";

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(frame: () => string | undefined, text: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (frame()?.includes(text)) return;
    await tick(20);
  }
  throw new Error(`没有等到 "${text}"，当前画面：\n${frame()}`);
}

function setup(runTurn: AppProps["session"]["runTurn"] = vi.fn()) {
  const diagnose = vi.fn((model: string) =>
    Promise.resolve({ ok: true, message: `${model} 已就绪` }),
  );
  const session: AppProps["session"] = {
    runTurn,
    readThread: () => Promise.resolve({ messages: [], sources: [] }),
    trace: { write: () => Promise.resolve() } as unknown as AppProps["session"]["trace"],
  };
  const app = render(
    <App
      session={session}
      models={["glm-5.2", "glm-5.3", "qwen3.8-max"]}
      diagnose={diagnose}
      createThreadId={() => "thread-1234-abcd"}
    />,
  );
  return { app, diagnose };
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("terminal UI", () => {
  it("picks a model with the arrow keys instead of typing its name", async () => {
    const { app, diagnose } = setup();
    cleanup = app.unmount;
    await tick();

    app.stdin.write(CTRL_P);
    await waitFor(app.lastFrame, "选择模型");
    app.stdin.write(DOWN);
    await tick();
    app.stdin.write(ENTER);

    await waitFor(app.lastFrame, "已切换到 glm-5.3，当前会话保留");
    expect(app.lastFrame()).not.toContain("选择模型");
    expect(diagnose).toHaveBeenLastCalledWith("glm-5.3");
  });

  it("opens the model picker from the slash command menu", async () => {
    const { app } = setup();
    cleanup = app.unmount;
    await tick();

    app.stdin.write("/mo");
    await waitFor(app.lastFrame, "/model");
    app.stdin.write(ENTER);
    await waitFor(app.lastFrame, "选择模型");
  });

  it("streams a report card and asks for approval with a picker", async () => {
    const runTurn = vi.fn<AppProps["session"]["runTurn"]>(async (input, { onEvent, approve }) => {
      onEvent({ type: "tool-start", id: "1", name: "web_search", input: { query: "闭包" } });
      const approved = await approve([{ name: "web_search", args: { query: "闭包" } }]);
      onEvent({ type: "tool-end", id: "1", ok: approved, detail: "2 条结果" });
      onEvent({
        type: "report",
        attempt: 0,
        report: { keyPoints: [{ claim: "闭包捕获词法作用域", kind: "fa" }] },
        complete: false,
      });
      await tick();
      const report = {
        summary: "闭包是函数与其词法环境的组合。",
        keyPoints: [{ claim: "闭包捕获词法作用域", kind: "fact" as const }],
        sources: [],
        uncertainties: [],
      };
      onEvent({ type: "report", attempt: 0, report, complete: true });
      return { report, answer: "研究报告已提交。", unverifiedUrls: [] };
    });
    const { app } = setup(runTurn);
    cleanup = app.unmount;
    await tick();

    app.stdin.write("什么是闭包");
    await tick();
    app.stdin.write(ENTER);
    await waitFor(app.lastFrame, "允许执行外部请求？");
    app.stdin.write(ENTER);

    await waitFor(app.lastFrame, "闭包是函数与其词法环境的组合。");
    const frame = app.lastFrame() ?? "";
    expect(runTurn.mock.calls[0]?.[0]).toEqual({
      text: "什么是闭包",
      threadId: "thread-1234-abcd",
      model: "glm-5.2",
    });
    expect(frame).toContain("✓ 已批准");
    expect(frame).toContain("[事实] 闭包捕获词法作用域");
    expect(frame).toContain("已完成");
  });
});
