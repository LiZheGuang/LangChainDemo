# LangChain CLI 开发者研究助手

一个用于边写边学 LangChain.js 的 TypeScript 项目。助手可以计算、获取时间、搜索资料、读取网页、保留会话，并在发起外部网络请求前要求人工审批。

## 运行要求

- Node.js 22+
- pnpm 10+（全局 pnpm 低于 10 时可用 `npx pnpm@10.20.0 <命令>`）
- 一个支持 tool calling 的模型：OpenAI-compatible 接口，或本地 [Ollama](https://ollama.com/)

```bash
cp .env.example .env
pnpm install
pnpm smoke   # 真实调用模型：诊断、invoke、stream、Agent 工具调用
pnpm dev
```

## 模型配置

模型只在 `src/config/model.ts` 中创建，业务代码不感知供应商。通过 `.env` 切换：

```dotenv
# OpenAI-compatible（如内部网关、vLLM、one-api 等）
MODEL_PROVIDER=openai-compatible
MODEL_NAME=glm-5.2
OPENAI_BASE_URL=http://host:port/v1   # 只写到 /v1，不要带 /chat/completions
OPENAI_API_KEY=sk-...
```

```dotenv
# 本地 Ollama
MODEL_PROVIDER=ollama
MODEL_NAME=qwen3:4b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

想在运行中切换模型，把可选模型写进 `MODEL_OPTIONS`（逗号分隔；不带前缀用 `MODEL_PROVIDER`，跨供应商写 `ollama:qwen3:4b`），然后在终端界面按 `Ctrl+P` 用方向键选择，当前会话保留：

```dotenv
MODEL_OPTIONS=glm-5.3,glm-5.3-flash,qwen3.8-max
```

较小的模型可能无法稳定调用工具：CLI 的最终报告靠模型调用 `ResearchReport` 工具提交（结构化输出），Web UI 则要求模型按约定的四个 Markdown 小节作答。

## 终端界面

`pnpm dev` 打开全屏终端界面（Ink）：研究报告以卡片形式边生成边显示，关键点用颜色区分“事实 / 推断”，工具调用显示状态与结果。

| 操作 | 方式 |
| --- | --- |
| 切换模型 | `Ctrl+P`，或输入 `/model`；↑↓ 或数字键选择，Enter 确认，Esc 取消 |
| 新会话 | `Ctrl+N` 或 `/new` |
| 命令菜单 | 输入 `/`，↑↓ 选择 `/history`、`/sources`、`/help`、`/exit` 等 |
| 审批外部请求 | `web_search` / `fetch_page` 会弹出批准 / 拒绝选择框 |
| 退出 | `Ctrl+C` |

管道输入（非 TTY）或 `pnpm dev:plain` 会使用逐行的纯文本模式，命令相同，`/model <名称>` 直接切换。

## 可选搜索服务

没有 API Key 时保持 `SEARCH_PROVIDER=manual`，直接在问题中提供 URL。自动搜索可以选择：

```dotenv
SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=...
```

或：

```dotenv
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=...
```

不要提交 `.env`。网页读取工具会限制协议、内网地址、响应类型、大小、超时和重定向，但它不是通用浏览器。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm eval
pnpm build
pnpm check
```

测试使用 LangChain `fakeModel` 和 mock HTTP，不需要模型、网络或 API Key。本地 Ollama 只用于手工端到端验收。

## 推荐练习

1. 运行 `pnpm dev`，先问一个不需要工具的问题。
2. 问“6 的 7 次方是多少”，观察 tool call：界面会先显示 `✓ 计算 {...}` 和结果，再边生成边显示报告卡片；随后输入 `/history`，看到 `[ai] → 调用 calculator`、`[tool]`、`[ai]` 三条消息，这就是一次完整的 Agent 循环。工具调用也会写入 `.data/traces/<thread_id>.jsonl`。
3. 提供一个公开技术文档 URL，批准访问后检查 `/sources`。
4. 继续追问，使用 `/history` 理解 `thread_id` 和 checkpoint。
5. 阅读 [`docs/learning-log.md`](docs/learning-log.md)，完成每阶段复盘题。

架构和数据流见 [`docs/architecture.md`](docs/architecture.md)。
