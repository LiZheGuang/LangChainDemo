import { randomUUID } from "node:crypto";
import { Command, MemorySaver, StateSchema } from "@langchain/langgraph";
import {
  AIMessage,
  createAgent,
  createMiddleware,
  humanInTheLoopMiddleware,
  modelRetryMiddleware,
  piiMiddleware,
  tool,
  toolRetryMiddleware,
  toolStrategy,
  type HITLRequest,
  type HITLResponse,
  type Interrupt,
  type ToolRuntime,
} from "langchain";
import * as z from "zod";
import { DEFAULT_SYSTEM_PROMPT } from "../config/prompts.js";
import { createChatModel } from "../models/createChatModel.js";
import { printMessages, printSection } from "../utils/printMessages.js";

const getWeather = tool(
  ({ city, day }) => `${city}${day === "tomorrow" ? "明天" : "今天"}的天气：晴，25°C`,
  {
    name: "get_weather",
    description: "查询指定城市的天气",
    schema: z.object({
      city: z.string().describe("城市名称"),
      day: z.enum(["today", "tomorrow"]).default("today").describe("查询今天还是明天"),
    }),
  },
);

const search = tool(({ query }) => `关于「${query}」的搜索结果：AI Agent、多模态、端侧模型是近期热点。`, {
  name: "search",
  description: "搜索信息",
  schema: z.object({ query: z.string() }),
});

/** 核心组件：model + tools + systemPrompt + name */
async function basic() {
  printSection("核心组件");
  const agent = createAgent({
    model: createChatModel(),
    tools: [getWeather, search],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    name: "research_assistant",
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: "北京今天天气怎么样？" }],
  });
  printMessages(result.messages);
}

/** 结构化输出：responseFormat 让 agent 返回经过校验的对象 */
async function structured() {
  printSection("结构化输出");
  const Answer = z.object({
    summary: z.string().describe("总结内容"),
    confidence: z.number().min(0).max(1).describe("置信度，0 到 1"),
  });

  const agent = createAgent({
    model: createChatModel(),
    tools: [search],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    responseFormat: toolStrategy(Answer),
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: "总结一下 AI 的发展趋势" }],
  });
  console.log("structuredResponse:", result.structuredResponse);
}

/** Agent 状态：通过中间件的 stateSchema 扩展自定义字段 */
async function state() {
  printSection("自定义状态");
  const MyState = new StateSchema({
    userId: z.string(),
    callCount: z.number().default(0),
  });

  const stateMiddleware = createMiddleware({
    name: "StateExtension",
    stateSchema: MyState,
    afterModel: (state) => ({ callCount: state.callCount + 1 }),
  });

  const agent = createAgent({
    model: createChatModel(),
    tools: [getWeather],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    middleware: [stateMiddleware],
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: "上海今天天气如何？" }],
    userId: "user-123",
  });
  console.log("userId:", result.userId, "| 模型调用次数 callCount:", result.callCount);
}

/** 多轮对话：checkpointer + thread_id 持久化对话历史 */
async function memory() {
  printSection("多轮对话（thread_id）");
  const agent = createAgent({
    model: createChatModel(),
    tools: [getWeather],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    checkpointer: new MemorySaver(),
  });

  const config = { configurable: { thread_id: randomUUID() } };

  await agent.invoke({ messages: [{ role: "user", content: "旧金山今天天气怎么样？" }] }, config);
  const result = await agent.invoke({ messages: [{ role: "user", content: "那明天呢？" }] }, config);
  printMessages(result.messages);
}

/** 运行时上下文：contextSchema 定义结构，工具通过 runtime.context 读取 */
async function context() {
  printSection("运行时上下文（context）");
  const contextSchema = z.object({ user_id: z.string() });

  const getUserProfile = tool(
    (_input, runtime: ToolRuntime<unknown, z.infer<typeof contextSchema>>) => {
      const profiles: Record<string, string> = { "user-123": "张三，常驻杭州，喜欢户外运动" };
      return profiles[runtime.context.user_id] ?? "未知用户";
    },
    {
      name: "get_user_profile",
      description: "获取当前用户的个人资料",
      schema: z.object({}),
    },
  );

  const agent = createAgent({
    model: createChatModel(),
    tools: [getUserProfile, getWeather],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    contextSchema,
  });

  const result = await agent.invoke(
    { messages: [{ role: "user", content: "根据我常驻的城市，告诉我今天适不适合户外运动" }] },
    { context: { user_id: "user-123" } },
  );
  printMessages(result.messages);
}

/** 流式输出：在执行过程中实时拿到中间步骤 */
async function stream() {
  printSection("流式输出");
  const agent = createAgent({
    model: createChatModel(),
    tools: [search],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });

  const run = await agent.streamEvents(
    { messages: [{ role: "user", content: "搜索 AI 新闻并总结" }] },
    { version: "v3" },
  );

  for await (const snapshot of run.values) {
    const latest = snapshot.messages.at(-1);
    if (!latest) continue;
    if (AIMessage.isInstance(latest) && latest.tool_calls?.length) {
      console.log(`调用工具: ${latest.tool_calls.map((tc) => tc.name).join(", ")}`);
    } else if (latest.text) {
      console.log(`[${latest.type}] ${latest.text}`);
    }
  }
}

/** 容错 + 护栏：重试中间件、PII（敏感信息）中间件 */
async function middleware() {
  printSection("中间件：重试 + PII 脱敏");
  const agent = createAgent({
    model: createChatModel(),
    tools: [search],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    middleware: [
      modelRetryMiddleware({ maxRetries: 3 }),
      toolRetryMiddleware({ maxRetries: 2 }),
      piiMiddleware("email", { strategy: "redact" }),
    ],
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: "我的邮箱是 zhangsan@example.com，请复述一遍我的邮箱" }],
  });
  printMessages(result.messages);
}

/** 人在回路：调用敏感工具前暂停，等人审批后继续 */
async function hitl() {
  printSection("人在回路（Human-in-the-loop）");
  const sendEmail = tool(({ to, subject }) => `已发送邮件给 ${to}，主题：${subject}`, {
    name: "send_email",
    description: "发送邮件",
    schema: z.object({ to: z.string(), subject: z.string() }),
  });

  const agent = createAgent({
    model: createChatModel(),
    tools: [sendEmail],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    middleware: [humanInTheLoopMiddleware({ interruptOn: { send_email: true } })],
    checkpointer: new MemorySaver(),
  });

  const config = { configurable: { thread_id: randomUUID() } };
  const first = await agent.invoke(
    { messages: [{ role: "user", content: "给 boss@example.com 发一封邮件，主题是「周报」" }] },
    config,
  );

  const interrupt = first.__interrupt__?.[0] as Interrupt<HITLRequest> | undefined;
  if (!interrupt) {
    console.log("模型没有调用 send_email，未触发审批");
    return;
  }
  console.log("⏸ 等待审批:", interrupt.value.actionRequests);

  const resume: HITLResponse = {
    decisions: interrupt.value.actionRequests.map(() => ({ type: "approve" as const })),
  };
  const final = await agent.invoke(new Command({ resume }), config);
  console.log("✅ 已批准，继续执行：");
  printMessages(final.messages);
}

const sections = { basic, structured, state, memory, context, stream, middleware, hitl };
type SectionName = keyof typeof sections;

const selected = process.argv[2] as SectionName | undefined;
if (selected && !(selected in sections)) {
  console.error(`未知示例：${selected}，可选：${Object.keys(sections).join(", ")}`);
  process.exit(1);
}

for (const [name, run] of Object.entries(sections)) {
  if (!selected || selected === name) await run();
}
