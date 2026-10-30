# 01 LangChain 概述

- 原文：[LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview)
- 示例代码：`src/examples/01-overview.ts`
- 运行：`pnpm overview`

---

## 一、核心观点：Agent = 模型 + Harness

> Agent = Model + Harness

| 组成 | 含义 |
|---|---|
| **模型（Model）** | 大语言模型本身（GPT、Claude、GLM 等），只会“读文字、输出文字”，自己不能执行任何操作 |
| **Harness（外层框架）** | 包在模型外面的一切：提示词、工具、中间件 |

Harness 的三个组成部分：

- **提示词（prompt）**：告诉模型它是谁、该怎么做；
- **工具（tools）**：模型可以调用的函数，比如查天气、查数据库；
- **中间件（middleware）**：在模型调用前后插入逻辑，比如重试、限流、敏感信息过滤、人工审批。

LangChain 提供的 harness 就是 **`createAgent`**（Python 中为 `create_agent`），特点是**最小化、高度可配置**：默认只有最基础的循环，其他能力按需叠加。

---

## 二、LangChain 生态各产品的关系

从底层到上层：

| 产品 | 定位 | 适合场景 |
|---|---|---|
| **LangGraph** | 底层编排框架，用“图”描述流程 | 需要精确控制每一步，固定流程与 agent 混合 |
| **LangChain**（`createAgent`） | 基于 LangGraph 的 agent 框架 | 大多数 agent 场景（当前学习重点） |
| **Deep Agents** | 基于 LangChain agent，开箱即用 | 复杂长任务，自带上下文压缩、虚拟文件系统、子 agent |
| **LangSmith** | 观测平台（不是框架） | 追踪、调试、评估以上任意一种 agent |

> 学习路线：先学 LangChain，覆盖大部分需求；遇到它表达不了的复杂流程，再下沉到 LangGraph。

---

## 三、示例代码讲解

### 1. 定义工具

```ts
const getWeather = tool(
  (input) => `It's always sunny in ${input.city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string().describe("The city to get the weather for"),
    }),
  },
);
```

`tool(函数, 配置)` 两部分：

- **函数**：工具真正执行的逻辑（示例中是假数据）。
- **配置**：写给模型看的“说明书”：
  - `name`：工具名，模型调用时用它；
  - `description`：**最关键**，模型靠它判断何时使用该工具，描述含糊会导致不调用或乱调用；
  - `schema`：用 zod 定义参数。LangChain 会将其转成 JSON Schema 发给模型，并用它校验模型返回的参数。`.describe()` 同样是写给模型看的。

### 2. 创建 agent

```ts
const agent = createAgent({
  model: createChatModel(),
  tools: [getWeather],
});
```

- 最简 agent 只需 **模型 + 工具列表**。
- `model` 支持两种写法：
  - **字符串**：`"gpt-5.5"`、`"ollama:devstral-2"`、`"google:gemini-2.5-flash-lite"` 等，LangChain 自动创建对应厂商的模型；
  - **模型实例**：如 `new ChatOpenAI({...})`，适合需要自定义配置的场景。
- 本项目使用内网的 OpenAI 兼容服务，需要自定义 `baseURL`，因此用 `createChatModel()` 返回模型实例（见 `src/models/createChatModel.ts`）。

> 文档给了 9 个厂商版本的示例，**唯一区别就是 `model` 这一行**，这正体现了“统一模型接口”。

#### 补充：用 `systemPrompt` 让模型用中文回答

文档原示例没有系统提示词，模型会跟着提问的语言回答（英文提问就用英文回答）。加上 `systemPrompt` 即可固定回答语言：

```ts
const agent = createAgent({
  model: createChatModel(),
  tools: [getWeather],
  systemPrompt: DEFAULT_SYSTEM_PROMPT, // 定义在 src/config/prompts.ts
});
```

- `systemPrompt` 就是 harness 中的“提示词”部分，会作为系统消息放在每次对话的最前面；
- 支持字符串或 `SystemMessage` 实例；
- 只影响模型生成的内容。工具返回值是我们自己代码写的（示例中是英文字符串），不受影响。

### 3. 调用 agent

```ts
const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in San Francisco?" }],
});
```

- 输入：消息数组 `messages`；
- 输出：`result.messages` 是**完整对话记录**，包含中间的工具调用过程。

---

## 四、Agent 运行过程（重点）

实际运行输出：

```
[human] What's the weather in San Francisco?
[ai]    tool_calls: [{ name: 'get_weather', args: { city: 'San Francisco' } }]
[tool]  It's always sunny in San Francisco!
[ai]    旧金山现在的天气是晴朗的！
```

| 步骤 | 消息类型 | 发生了什么 |
|---|---|---|
| 1 | `human` | 用户提问 |
| 2 | `ai`（带 `tool_calls`） | 模型决定调用 `get_weather`，并给出参数。**模型本身不执行函数**，只输出“调用请求” |
| 3 | `tool` | `createAgent` 执行工具函数，把返回值作为工具消息加回对话 |
| 4 | `ai`（最终回答） | 模型再次被调用，看到工具结果后组织语言回答 |

**循环规则**：模型决策，harness 执行工具并把结果交回模型；重复这一过程，直到模型不再请求工具、直接回答。

这种模式叫 **ReAct**（Reasoning + Acting，推理 + 行动）。不用框架的话，需要自己写循环、解析 `tool_calls`、分发执行、拼接消息，`createAgent` 把这些都自动化了。

---

## 五、LangChain 的四个核心优势

1. **统一的模型接口**：各厂商调用方式一致，切换模型几乎不改代码。
   本项目中修改 `.env` 的 `MODEL_PROVIDER`（`ollama` / `openai-compatible`）即可切换，业务代码不用动。
2. **高度可配置的 harness**：从最小的 `createAgent` 起步，通过**中间件**逐步添加护栏、重试、模型路由、工具调用策略等能力。
3. **构建在 LangGraph 之上**：天然具备
   - 持久化执行（中断后可恢复）；
   - 人在回路（关键操作前暂停，等人确认）；
   - 状态持久化（记住对话历史）。
4. **LangSmith 调试**：可视化查看每次模型调用、工具调用、耗时、token 用量。
   开启方式：设置环境变量 `LANGSMITH_TRACING=true` 和 `LANGSMITH_API_KEY`。

---

## 六、本项目的工程配置

| 文件 | 作用 |
|---|---|
| `package.json` | pnpm 管理依赖，`"type": "module"` 使用 ESM |
| `tsconfig.json` | TS 严格模式，`NodeNext` 模块解析（相对导入需写 `.js` 后缀） |
| `src/config/env.ts` | 用 zod 校验 `.env` 环境变量 |
| `src/models/createChatModel.ts` | 根据配置创建 `ChatOllama` 或 `ChatOpenAI` 实例 |

核心依赖：

| 包 | 作用 |
|---|---|
| `langchain` | `createAgent`、`tool`、消息类型等 |
| `@langchain/core` | 底层抽象（模型基类、消息等） |
| `@langchain/openai` | OpenAI 及兼容接口的模型 |
| `@langchain/ollama` | 本地 Ollama 模型 |
| `zod` | 定义工具参数 schema |
| `tsx` | 直接运行 TS 文件 |

> 注意：上层目录 `~/zheguangCode/package.json` 声明了 yarn，本项目在自己的 `package.json` 中声明 `"packageManager": "pnpm@9.15.4"` 来避免冲突。

---

## 七、小结

1. LangChain 的核心是 `createAgent`，agent 由**模型 + 工具 + 提示词 + 中间件**组成；
2. 工具的 `description` 和 `schema` 是写给模型看的，决定模型能否正确使用工具；
3. Agent 运行是一个“**模型决策、执行工具、交回模型**”的循环，`createAgent` 自动完成；
4. 模型调用方式统一，切换厂商只需改 `model`。

**下一步**：Installation（安装）和 Quickstart（快速入门）。
