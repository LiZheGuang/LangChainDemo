import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { fakeModel } from "langchain";
import {
  createResearchAgent,
  createStructuredResearchAgent,
} from "../src/agent/create-research-agent.js";
import {
  parseResearchReport,
  REPORT_SUBMITTED_MESSAGE,
  RESEARCH_REPORT_TOOL,
  type StructuredResearchReport,
} from "../src/schemas/research-report.js";
import type { SearchProvider } from "../src/tools/search.js";

const noSearch: SearchProvider = {
  name: "fake",
  search: () => Promise.resolve([]),
};

const answer = `## 结论
6 乘以 7 等于 42。

## 关键点
- 由 calculator 工具计算得出。

## 来源
- 无

## 不确定性
- 无`;

describe("research agent", () => {
  it("runs a tool call and ends with a Markdown report", async () => {
    const model = fakeModel()
      .respond(
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "calculator-1",
              name: "calculator",
              args: { left: 6, operator: "multiply", right: 7 },
              type: "tool_call",
            },
          ],
        }),
      )
      .respond(new AIMessage(answer));
    const agent = createResearchAgent({ model, searchProvider: noSearch });

    const result = await agent.invoke(
      { messages: [{ role: "user", content: "6 乘以 7 是多少？" }] },
      { configurable: { thread_id: "tool-test" } },
    );

    const toolMessage = result.messages.find(
      (message) => message instanceof ToolMessage && message.name === "calculator",
    );
    expect(toolMessage?.content).toContain("42");
    expect(parseResearchReport(result.messages.at(-1)?.text ?? "")).toMatchObject({
      summary: "6 乘以 7 等于 42。",
      keyPoints: ["由 calculator 工具计算得出。"],
    });
  });

  it("returns a schema-validated structuredResponse from the structured agent", async () => {
    const report: StructuredResearchReport = {
      summary: "6 乘以 7 等于 42。",
      keyPoints: [{ claim: "由 calculator 工具计算得出。", kind: "fact" }],
      sources: [],
      uncertainties: [],
    };
    const model = fakeModel()
      .respond(
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "calculator-1",
              name: "calculator",
              args: { left: 6, operator: "multiply", right: 7 },
              type: "tool_call",
            },
          ],
        }),
      )
      .respond(
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "report-1", name: RESEARCH_REPORT_TOOL, args: report, type: "tool_call" },
          ],
        }),
      );
    const agent = createStructuredResearchAgent({ model, searchProvider: noSearch });

    const result = await agent.invoke(
      { messages: [{ role: "user", content: "6 乘以 7 是多少？" }] },
      { configurable: { thread_id: "structured-test" } },
    );

    expect(result.structuredResponse).toEqual(report);
    expect(result.messages.at(-1)?.text).toBe(REPORT_SUBMITTED_MESSAGE);
  });

  it("keeps messages in a thread-scoped checkpoint", async () => {
    const model = fakeModel()
      .respond(new AIMessage(answer))
      .respond(new AIMessage(answer));
    const checkpointer = new MemorySaver();
    const agent = createResearchAgent({
      model,
      searchProvider: noSearch,
      checkpointer,
    });
    const config = { configurable: { thread_id: "memory-test" } };

    await agent.invoke({ messages: [{ role: "user", content: "记住 alpha" }] }, config);
    await agent.invoke(
      { messages: [{ role: "user", content: "我让你记住什么？" }] },
      config,
    );

    const saved = await checkpointer.get(config);
    const messages = saved?.channel_values.messages as unknown[];
    const humanTurns = messages.filter(
      (message) => (message as { getType?: () => string }).getType?.() === "human",
    );
    expect(humanTurns).toHaveLength(2);
  });

  it("pauses search for approval, then records deduplicated sources per thread", async () => {
    const searchProvider: SearchProvider = {
      name: "fake",
      search: () =>
        Promise.resolve([
          { title: "Tools", url: "https://example.com/tools", snippet: "" },
          { title: "Tools again", url: "https://example.com/tools", snippet: "" },
        ]),
    };
    const model = fakeModel()
      .respond(
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "search-1",
              name: "web_search",
              args: { query: "LangChain tools", limit: 2 },
              type: "tool_call",
            },
          ],
        }),
      )
      .respond(new AIMessage(answer))
      .respond(new AIMessage(answer));
    const agent = createResearchAgent({
      model,
      searchProvider,
      checkpointer: new MemorySaver(),
    });
    const config = { configurable: { thread_id: "sources-test" } };

    const paused = await agent.invoke(
      { messages: [{ role: "user", content: "查一下 LangChain tools" }] },
      config,
    );
    expect(paused.__interrupt__).toHaveLength(1);
    expect(paused.sources).toEqual([]);

    const resumed = await agent.invoke(
      new Command({ resume: { decisions: [{ type: "approve" }] } }),
      config,
    );
    expect(resumed.sources).toEqual([
      { title: "Tools again", url: "https://example.com/tools" },
    ]);

    const other = await agent.invoke(
      { messages: [{ role: "user", content: "hi" }] },
      { configurable: { thread_id: "another-thread" } },
    );
    expect(other.sources).toEqual([]);
  });

  it("switches models per call through context while keeping the thread history", async () => {
    const defaultModel = fakeModel().respond(new AIMessage("默认模型的回答"));
    const fastModel = fakeModel().respond(new AIMessage("快速模型的回答"));
    const requested: string[] = [];
    const agent = createResearchAgent({
      model: defaultModel,
      resolveModel: (id) => {
        requested.push(id);
        return fastModel;
      },
      searchProvider: noSearch,
      checkpointer: new MemorySaver(),
    });
    const configurable = { thread_id: "model-switch-test" };

    const first = await agent.invoke(
      { messages: [{ role: "user", content: "第一问" }] },
      { configurable },
    );
    expect(first.messages.at(-1)?.text).toBe("默认模型的回答");

    const second = await agent.invoke(
      { messages: [{ role: "user", content: "第二问" }] },
      { configurable, context: { model: "fast" } },
    );
    expect(requested).toEqual(["fast"]);
    expect(second.messages.map((message) => message.text)).toEqual([
      "第一问",
      "默认模型的回答",
      "第二问",
      "快速模型的回答",
    ]);
  });
});
