# 02 Agents

- 原文：[Agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- 示例代码：`src/examples/02-agents.ts`
- 运行全部示例：`pnpm agents`
- 运行单个示例：`pnpm agents <名称>`，名称可选：`basic`、`structured`、`state`、`memory`、`context`、`stream`、`middleware`、`hitl`

---

## 一、一句话概括

这一章讲的是：**`createAgent` 到底能配置哪些东西。**

两句核心定义：

> 一个 agent，就是模型在一个循环里不断调用工具，直到任务完成。

> Harness 的职责：在正确的时间，把正确的上下文交给模型。

后面讲的每个功能，本质上都在回答：**模型此刻该看到什么、能做什么。**

### 章节地图

| 部分 | 内容 |
|---|---|
| 核心组件 | 模型、工具、系统提示词、结构化输出、状态 |
| 调用方式 | 多轮对话（`thread_id`）、运行时上下文（`context`）、流式输出 |
| 配置 harness | 用中间件添加容错、护栏、人工审批等能力 |

---

## 二、核心组件

### 1. 模型、工具、系统提示词

| 参数 | 说明 |
|---|---|
| `model` | 字符串（如 `"openai:gpt-5.5"`）或模型实例。本项目用 `createChatModel()` 返回实例 |
| `tools` | 工具数组 |
| `systemPrompt` | 字符串或 `SystemMessage`。**运行时动态修改提示词需要用中间件** |
| `name` | 给 agent 起名，多 agent 协作时用来区分身份 |

```ts
const agent = createAgent({
  model: createChatModel(),
  tools: [getWeather, search],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  name: "research_assistant",
});
```

### 2. 结构化输出（`responseFormat`）

**解决的问题**：自然语言回答适合人读，程序很难使用。需要存数据库、渲染页面时，要的是固定格式的对象。

**用法**：用 zod 定义格式，传给 `responseFormat`，从 `result.structuredResponse` 取结果。

```ts
const Answer = z.object({
  summary: z.string().describe("总结内容"),
  confidence: z.number().min(0).max(1).describe("置信度，0 到 1"),
});

const agent = createAgent({
  model: createChatModel(),
  tools: [search],
  responseFormat: toolStrategy(Answer),
});

const result = await agent.invoke({ messages: [...] });
result.structuredResponse; // { summary: "...", confidence: 0.9 }
```

**两种实现策略**：

| 策略 | 原理 | 优缺点 |
|---|---|---|
| `providerStrategy` | 调用模型接口的原生 JSON Schema 输出能力 | 可靠，但依赖厂商支持 |
| `toolStrategy` | 把 schema 伪装成一个工具，模型调用它时传的参数就是结构化数据 | 只要模型会调工具就能用，兼容性最好 |

- 只传 zod schema 时，LangChain 根据模型的 `profile.structuredOutput` 自动选择策略。
- ⚠️ **踩坑记录**：本项目使用内网代理加 qwen，自动选择时 `structuredResponse` 返回 `undefined`，推测是走了原生策略，但代理没有支持。**显式指定 `toolStrategy(Answer)` 解决。**

### 3. Agent 状态（State）

`AgentState` 是 agent 运行过程中的“共享记事本”。

| 内置字段 | 类型 | 说明 |
|---|---|---|
| `messages` | `BaseMessage[]` | 完整对话记录，**只追加、不替换** |

**扩展自定义字段**：通过中间件的 `stateSchema`：

```ts
const MyState = new StateSchema({
  userId: z.string(),
  callCount: z.number().default(0),
});

const stateMiddleware = createMiddleware({
  name: "StateExtension",
  stateSchema: MyState,
  afterModel: (state) => ({ callCount: state.callCount + 1 }), // 每次模型调用后 +1
});
```

- 中间件的钩子（`beforeModel`、`afterModel` 等）接收当前 state，返回的对象会**合并**回 state。
- 调用时可以直接传入自定义字段：`agent.invoke({ messages, userId: "user-123" })`。

**运行结果**：`callCount: 2`

> 💡 **一次提问 ≠ 一次模型调用**
> 1. 第 1 次调用模型：决定调用 `get_weather`
> 2. 执行工具
> 3. 第 2 次调用模型：根据工具结果组织回答
>
> 工具调用越多，模型调用次数越多，成本越高。

---

## 三、调用方式

### 4. 多轮对话：`thread_id` + `checkpointer`

**问题**：默认每次 `invoke` 都是全新对话，agent 不记得之前聊过什么。

**解决**：

| 组成 | 作用 |
|---|---|
| `checkpointer` | 存档器，保存对话状态。`MemorySaver` 存在内存里，程序重启就丢失；生产环境换成数据库 |
| `thread_id` | 会话 ID，同一个 ID 表示同一段对话 |

```ts
const agent = createAgent({
  model: createChatModel(),
  tools: [getWeather],
  checkpointer: new MemorySaver(),
});

const config = { configurable: { thread_id: randomUUID() } };

await agent.invoke({ messages: [{ role: "user", content: "旧金山今天天气怎么样？" }] }, config);
await agent.invoke({ messages: [{ role: "user", content: "那明天呢？" }] }, config);
```

**运行结果**：

```
[human] 旧金山今天天气怎么样？
...
[human] 那明天呢？
[ai]    调用 get_weather，参数 { city: '旧金山', day: 'tomorrow' }
```

第二个问题没提城市，模型却知道是旧金山，因为同一 `thread_id` 下的历史被存下来并交给了模型。

> 文档用 `langsmith` 的 `uuid7()` 生成 ID，本项目用 Node 自带的 `crypto.randomUUID()`，效果相同。

### 5. 运行时上下文：`context`

**问题**：当前用户 ID、API key、功能开关等“单次运行专属”的信息，工具需要用到，但不应该放进对话。

**用法**：`contextSchema` 定义格式，调用时传 `context`，工具通过 `runtime.context` 读取。

```ts
const contextSchema = z.object({ user_id: z.string() });

const getUserProfile = tool(
  (_input, runtime: ToolRuntime<unknown, z.infer<typeof contextSchema>>) => {
    return profiles[runtime.context.user_id] ?? "未知用户";
  },
  { name: "get_user_profile", description: "获取当前用户的个人资料", schema: z.object({}) },
);

const agent = createAgent({ model, tools: [getUserProfile], contextSchema });

await agent.invoke(
  { messages: [...] },
  { context: { user_id: "user-123" } },
);
```

**运行结果**：模型调用 `get_user_profile` 时传的参数是空的 `{}`，工具照样查到“常驻杭州”。因为 `user_id` 是程序通过 `context` 直接给工具的，不经过模型。

> 🔒 **安全意义**：如果 `user_id` 作为工具参数由模型填写，用户可能通过提示词诱导模型查询他人资料（越权）。放在 `context` 中，模型根本接触不到。

### ⭐ 区分三个易混淆的概念

| 概念 | 作用 | 模型能看到吗 | 生命周期 |
|---|---|---|---|
| `state.messages` | 对话记录 | 能 | 随对话增长 |
| `thread_id` | 标识哪段对话，用来存取历史 | 不能 | 一段对话 |
| `context` | 单次运行的配置（用户 ID 等） | 不能，只有工具和中间件能读 | 单次调用 |

**记忆口诀**：`thread_id` 管“记住什么”，`context` 管“这次是谁、用什么配置”。

### 6. 流式输出：`streamEvents`

**问题**：`invoke` 要等整个循环跑完才返回，多次工具调用时用户只能干等。

**用法**：

```ts
const run = await agent.streamEvents(
  { messages: [{ role: "user", content: "搜索 AI 新闻并总结" }] },
  { version: "v3" },
);

for await (const snapshot of run.values) {
  const latest = snapshot.messages.at(-1); // 每个 snapshot 是当时的完整 state
  if (AIMessage.isInstance(latest) && latest.tool_calls?.length) {
    console.log(`调用工具: ${latest.tool_calls.map((tc) => tc.name).join(", ")}`);
  } else if (latest?.text) {
    console.log(`[${latest.type}] ${latest.text}`);
  }
}
```

**运行结果**：

```
[human] 搜索 AI 新闻并总结
调用工具: search
[tool] 关于「最新 AI 人工智能 新闻 2024」的搜索结果……
调用工具: search
[tool] 关于「AI Agent 多模态 端侧模型 最新进展 2024」的搜索结果……
```

模型**主动搜索了两次**，第二次根据第一次的结果换了更精确的关键词。这就是 agent 与普通一问一答的区别：**根据中间结果自主决定下一步**。

> ⚠️ **踩坑记录**：`message.content` 可能是字符串，也可能是“内容块”数组，直接打印会变成 `[object Object]`。**统一用 `message.text` 提取文本。**

---

## 四、用中间件配置 harness

> 中间件是定制 agent 的基本单位。每个中间件只负责一件事，在循环的合适时机介入，可以自由组合。

类比：Express/Koa 的中间件、Vue Router 的路由守卫，在模型调用前后、工具调用前后插入逻辑。

### 中间件的六大类

| 类别 | 解决的问题 | 例子 | 本章是否实践 |
|---|---|---|---|
| 执行环境 | 让 agent 能动手干活 | 文件系统、沙箱、代码执行 | 否（需 `deepagents`） |
| 上下文管理 | 对话过长超出上下文窗口 | 自动摘要、长期记忆、技能按需加载 | 否（需 `deepagents`） |
| 规划与委派 | 任务太复杂，一个 agent 装不下 | 待办清单、子 agent | 否（需 `deepagents`） |
| 容错 | 限流、超时、网络抖动 | `modelRetryMiddleware`、`toolRetryMiddleware` | ✅ |
| 护栏 | 有些规则不能靠模型自觉 | `piiMiddleware` | ✅ |
| 引导 | 关键操作需要人拍板 | `humanInTheLoopMiddleware` | ✅ |

### 7. 容错：重试

```ts
middleware: [
  modelRetryMiddleware({ maxRetries: 3 }), // 模型调用失败最多重试 3 次
  toolRetryMiddleware({ maxRetries: 2 }),  // 工具调用失败最多重试 2 次
],
```

好处：业务代码不用到处写 try/catch，重试统一放在基础设施层。

### 8. 护栏：PII 敏感信息脱敏

> 有些规则不能写在提示词里，必须被**确定性地执行**，不管模型怎么做。

提示词里写“不要泄露邮箱”，模型**大概率**遵守，但不是 100%。护栏用代码强制执行。

```ts
piiMiddleware("email", { strategy: "redact" })
```

| 参数 | 可选值 |
|---|---|
| 内置类型 | `email`、`credit_card`、`ip`、`mac_address`、`url` |
| `strategy` | `redact`（替换为占位符）、`mask`（部分遮盖）、`hash`（哈希）、`block`（直接报错） |
| `applyToInput` | 检查用户消息，默认 `true` |
| `applyToOutput` | 检查模型回复，默认 `false` |
| `applyToToolResults` | 检查工具结果，默认 `false` |

**运行结果**：

```
[human] 我的邮箱是 [REDACTED_EMAIL]，请复述一遍我的邮箱
[ai]    您提供的邮箱地址显示为 [REDACTED_EMAIL]……我无法看到具体的邮箱内容
```

邮箱在**发给模型之前**就被替换了，模型从头到尾没见过真实邮箱，想泄露也泄露不了。

### 9. 引导：人在回路（Human-in-the-loop）

**问题**：发邮件、删数据、付款等操作不能让 agent 全自动执行。

**流程**：

```ts
const agent = createAgent({
  model: createChatModel(),
  tools: [sendEmail],
  middleware: [humanInTheLoopMiddleware({ interruptOn: { send_email: true } })],
  checkpointer: new MemorySaver(), // 必须
});

// 第一步：调用，执行到 send_email 时暂停
const first = await agent.invoke({ messages: [...] }, config);
const interrupt = first.__interrupt__?.[0] as Interrupt<HITLRequest>;
// interrupt.value.actionRequests → 待审批的操作列表

// 第二步：人工审批后恢复
const resume: HITLResponse = {
  decisions: interrupt.value.actionRequests.map(() => ({ type: "approve" as const })),
};
await agent.invoke(new Command({ resume }), config);
```

**审批决策类型**：

| 类型 | 含义 |
|---|---|
| `approve` | 按原参数执行 |
| `edit` | 修改工具名或参数后执行 |
| `reject` | 拒绝执行，可附带说明 |
| `respond` | 不执行工具，直接给出回复 |

**`interruptOn` 配置**：

- `true`：需要审批，允许所有决策类型；
- `false`：自动放行；
- `{ allowedDecisions: ["approve", "reject"], description: "..." }`：精细控制。

**运行结果**：

```
⏸ 等待审批: [{ name: 'send_email', args: { to: 'boss@example.com', subject: '周报' } }]
✅ 已批准，继续执行：
[tool] 已发送邮件给 boss@example.com，主题：周报
```

> 💡 **为什么必须配合 `checkpointer`？** 暂停时要把状态存下来，恢复时才能从断点继续。暂停和恢复是 LangGraph 原生提供的能力，这正是“LangChain 构建在 LangGraph 之上”的好处。

> ⚠️ **遗留问题**：审批通过后工具正常执行，但模型最后的总结回复为空。这是模型本身的输出问题，不影响审批流程，暂未排查。

---

## 五、新增依赖与文件

| 项 | 说明 |
|---|---|
| `@langchain/langgraph` | 提供 `MemorySaver`、`StateSchema`、`Command`。它本是 `langchain` 的间接依赖，但 pnpm 不允许直接导入间接依赖，所以加为直接依赖 |
| `src/utils/printMessages.ts` | 公共打印工具：`printMessages`、`printSection` |
| `src/examples/02-agents.ts` | 8 个示例，可通过命令行参数单独运行 |

---

## 六、本章小结

1. **Agent 是“模型在循环里调用工具”**，harness 的职责是“在正确的时间给模型正确的上下文”。
2. **核心组件**：模型、工具、系统提示词是基础；`responseFormat` 让输出变成对象；`state` 是共享记事本。
3. **一次提问可能触发多次模型调用**，工具调用越多，成本越高。
4. **`thread_id` + `checkpointer` 实现记忆**，**`context` 传单次运行的配置**，不要混淆。
5. **流式输出**解决“干等”问题，还能观察 agent 的自主决策过程。
6. **中间件是扩展 agent 的基本方式**。护栏的意义在于用代码强制执行，而不是靠提示词让模型自觉。

---

## 七、思考题

1. 如果去掉 `checkpointer`，只保留 `thread_id`，“那明天呢？”还能被正确理解吗？为什么？
2. 用户的会员等级（普通 / VIP）会影响工具的查询权限，它应该放在 `context` 里，还是作为工具参数让模型传？
3. 为什么人在回路一定要配合 `checkpointer`，而 PII 脱敏不需要？

<details>
<summary>参考答案</summary>

1. **不能**。`thread_id` 只是一个标签，真正负责保存和读取历史的是 `checkpointer`。没有存档器，每次调用仍是全新对话，模型不知道之前问的是哪个城市。
2. **放在 `context` 里**。权限相关的信息必须由程序控制，不能交给模型。否则用户可以通过提示词诱导模型传 `"VIP"`，从而越权。
3. 人在回路需要**跨两次调用**：第一次暂停，第二次恢复，中间的状态必须存下来。PII 脱敏在**单次调用内**完成，消息发给模型前就处理掉了，不需要保存任何中间状态。

</details>
