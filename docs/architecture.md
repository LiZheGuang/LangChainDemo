# 架构说明

## 数据流

1. `src/cli.ts` 把用户输入和 `thread_id` 交给 Agent。
2. `createAgent` 让模型决定直接回答或调用工具。
3. calculator/current_time 直接执行；web_search/fetch_page 先被 HITL middleware 中断。
4. CLI 将 approve/reject 包装为 `Command`，使用同一个 `thread_id` 恢复。
5. `MemorySaver` 保存 thread 内消息和中断状态。
6. CLI 使用 `createStructuredResearchAgent`：模型通过 `toolStrategy` 生成的 `ResearchReport` 工具提交最终报告，Zod 校验后放在 `structuredResponse` 里，由 CLI 格式化打印；工具调用过程仍通过 `streamEvents` 实时显示。随后核对报告中的链接是否被工具实际搜索或读取过；本地 trace 写入 `.data/traces`。Agent Server 和 Web UI 用的 `createResearchAgent` 仍输出逐 token 流式的 Markdown。

## 模块边界

- `config`：环境变量和模型供应商适配。业务代码不直接实例化 Ollama。
- `tools`：小而独立的能力，输入均由 Zod 描述。
- `agent`：提示词、工具和 middleware 的组装层；`model-switch` 按 `context.model` 在每次模型调用前换模型（白名单来自 `MODEL_OPTIONS`）。
- `memory`：与会话相关但不依赖终端 UI 的状态。
- `schemas`：最终答案的两种契约——结构化输出的 Zod schema（CLI），以及 Markdown 四个小节的约定和解析器（Web UI、评测）。
- `observability`：可替换的追踪层，当前为脱敏 JSONL。
- `evaluation`：对格式、关键词和来源的确定性检查。

## 安全边界

- 网页正文包在 `untrusted_web_content` 中，系统提示明确禁止执行网页指令。
- fetch_page 只允许 HTTP/HTTPS，拒绝凭据、localhost、解析后的私网/保留地址。
- 每次重定向都会重新检查目标，并限制超时、正文大小和内容类型。
- 外部搜索和网页访问必须人工批准。
- trace 对常见 key/token 字段脱敏，`.env` 和 `.data` 不入库。

DNS 校验和实际连接之间仍存在 DNS rebinding 的理论窗口；若部署为公网服务，应使用隔离网络、出口代理和请求级 DNS pinning，而不是只依赖应用层校验。

## 后续 Web UI

未来 Web UI 只需替换 CLI 层：把输入、token、interrupt 和最终报告映射为 HTTP/SSE 或 WebSocket。Agent、工具、schema 和评测层可保持不变。生产环境还应把 `MemorySaver` 换成持久化 checkpointer，并加入用户身份与 thread 所有权校验。
