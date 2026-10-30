# 学习日志

这不是 API 清单。每阶段先运行代码，再用自己的话补全“我的解释”和复盘答案。

## 第 1 周：Model、Message、invoke、stream

前端类比：

- Model 类似带默认配置和重试策略的 API client。
- Message 类似有角色和内容约束的 DTO。
- `invoke` 类似一次性 JSON 请求；`stream` 类似逐块消费 SSE。
- Prompt 是运行时上下文，不是安全边界，也不是模型训练。

运行时切换模型不需要重建 Agent：`createModelSwitchMiddleware` 在 `wrapModelCall` 里按 `context.model` 换掉 `request.model`，调用方用 `agent.streamEvents(input, { context: { model } })` 传入。消息历史存在 checkpointer 里、与供应商无关，所以同一个 thread 换模型后仍能接着聊。可选模型是 `.env` 里 `MODEL_OPTIONS` 的白名单，`context` 来自调用方，不能让它指定任意模型。终端界面的 `Ctrl+P` 模型选择框就是这样实现的。

代码入口：`src/config/model.ts`、`src/agent/model-switch.ts`、`src/cli.ts`。

练习：把模型名改到 `.env`；用 `/model` 在同一会话里切到一个小模型，观察它是否还会调用 `ResearchReport`；分别观察 Ollama 未启动、模型未下载和正常运行时的结果。

复盘：

1. 这层抽象解决什么问题？
2. 不用 Message 而直接拼字符串会损失什么？
3. 模型调用失败时，如何区分配置、网络和模型能力问题？

我的解释：待补充。

## 第 2 周：Tool 与结构化数据

Tool 不是“模型会的新知识”，而是模型可以申请执行的普通函数。Zod schema 同时服务于运行时校验、类型推断和模型理解。纯工具容易测试；网络工具必须有超时、安全和错误边界。

代码入口：`src/tools/`、`tests/tools.test.ts`、`tests/fetch-page.test.ts`。

练习：新增一个只读的 npm package 信息工具，并先写测试。

复盘：

1. 为什么 calculator 不应使用 `eval`？
2. 为什么 tool description 会影响工具选择？
3. 网页内容为什么必须视为不可信输入？

我的解释：待补充。

## 第 3 周：Agent 循环与输出契约

Agent 是循环，不是单次 prompt：模型提出 tool call，程序执行并返回 ToolMessage，模型再决定下一步。

输出格式有一个取舍：`responseFormat` + `toolStrategy` 让模型通过“调用一个工具”交答案，能用 Zod 严格校验，但答案藏在工具参数 JSON 里，`message.text` 流不出任何字。CLI 改为读取消息流的原始事件：`tool-call-delta` 不断追加参数片段，用 `parsePartialJson` 解析半截 JSON 并只打印新增部分（`src/report-view.ts`），打字机效果就回来了。本项目两种都用：

- CLI 用 `createStructuredResearchAgent`：`toolStrategy(researchReportSchema)` 根据 schema 的 `title` 生成一个 `ResearchReport` 工具，模型调用它交卷，校验通过的结果在 `structuredResponse` 里。schema 不合法时框架会把错误作为 ToolMessage 回给模型并自动重试（`handleError` 默认为 `true`）。关键点还带 `kind: "fact" | "inference"`，事实与推断的区分从提示词约定变成了类型约束。
- Web UI 用 `createResearchAgent`：在系统提示里约定 Markdown 四个小节，正文可以逐 token 流式输出，结束后由 `parseResearchReport` 在本地解析。

两边的引用链接都会再与 thread 状态里的 `sources` 核对。`toolMessageContent` 用来替换写进历史的提交提示（默认是整份 JSON）；用 `streamEvents` 时这条提示也会出现在 `stream.messages` 里，CLI 需要把它跳过。

代码入口：`src/agent/create-research-agent.ts`、`src/schemas/research-report.ts`。

练习：在 fake model 测试里增加两次连续工具调用；把 recursionLimit 调小并观察失败。

复盘：

1. Agent 和固定 workflow 分别适合什么任务？
2. 最大步数和超时防止什么问题？
3. 格式解析失败应重试、降级还是报错？
4. 什么场景必须用 `responseFormat` 严格结构化，什么场景流式体验更重要？

我的解释：待补充。

## 第 4 周：LangGraph、Checkpoint 与 HITL

Checkpoint 保存 thread 的图状态；长期用户记忆是另一个问题，不应把所有历史无限塞入 prompt。Interrupt 让图在副作用前暂停，`Command` 在同一 thread 中恢复。

代码入口：`src/session/research-session.ts` 中的 `thread_id`、`Command` 和 approval loop。

练习：分别批准和拒绝同一 URL；使用 `/new` 比较新旧 thread。

复盘：

1. 为什么恢复中断必须复用 thread_id？
2. checkpoint 与数据库中的用户偏好有什么区别？
3. 哪些工具可以自动批准，依据是什么？

我的解释：待补充。

## 第 5 周：研究流程与来源

搜索只提供候选来源；读取、比较、去重和引用才形成研究证据链。无 Key 的 manual provider 是显式降级，不通过抓取搜索结果页制造脆弱依赖。

代码入口：`src/tools/search.ts`、`src/memory/source-store.ts`、`/sources`。

练习：配置一个搜索 provider，比较摘要与原网页是否一致。

复盘：

1. 为什么搜索摘要不能直接当事实来源？
2. 来源去重应该按 URL、canonical URL 还是内容？
3. 上下文过长时应保留哪些信息？

我的解释：待补充。

## 第 6 周：评测与可观测性

LLM 输出有随机性，应用验收必须拆成可测属性：格式、工具路径、引用、关键事实和错误恢复。单元测试覆盖确定性部分；少量端到端案例观察真实模型。

代码入口：`src/evaluation/`、`src/observability/`、`tests/evaluation.test.ts`。

练习：新增三个固定研究问题，明确每题期望术语、是否必须有来源和允许的不确定性。

复盘：

1. 为什么不能只做字符串快照？
2. fake model 能证明什么，不能证明什么？
3. trace 中哪些信息有用，哪些信息不得记录？

我的解释：待补充。
