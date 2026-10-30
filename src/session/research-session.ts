import type { BaseMessage } from "@langchain/core/messages";
import { parsePartialJson } from "@langchain/core/output_parsers";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createStructuredResearchAgent } from "../agent/create-research-agent.js";
import type { Source } from "../agent/sources-state.js";
import { findUnverifiedUrls } from "../evaluation/evaluate-report.js";
import { TraceWriter } from "../observability/trace.js";
import { reportText } from "../report-view.js";
import {
  REPORT_SUBMITTED_MESSAGE,
  RESEARCH_REPORT_TOOL,
  type StructuredResearchReport,
} from "../schemas/research-report.js";

export interface ApprovalAction {
  name: string;
  args: unknown;
}

export type TurnEvent =
  /** Streamed answer text; `startsBlock` marks the first chunk of a new model message. */
  | { type: "text"; text: string; startsBlock: boolean }
  /** The report as parsed so far. A retried submission gets a new `attempt`. */
  | { type: "report"; attempt: number; report: object; complete: boolean }
  | { type: "tool-start"; id: string; name: string; input: unknown }
  | { type: "tool-end"; id: string; ok: boolean; detail: string };

export interface TurnHandlers {
  onEvent: (event: TurnEvent) => void;
  /** Resolves `true` to approve every pending external request. */
  approve: (actions: ApprovalAction[]) => Promise<boolean>;
}

export interface TurnInput {
  text: string;
  threadId: string;
  model: string;
}

export interface TurnResult {
  report?: StructuredResearchReport;
  answer: string;
  unverifiedUrls: string[];
}

export function preview(value: unknown, maxLength = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const singleLine = text.replace(/\s+/g, " ");
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}…` : singleLine;
}

function pendingActions(interrupts: unknown[]): ApprovalAction[] {
  type Requests = { actionRequests?: Array<{ name?: string; args?: unknown }> };
  const first = interrupts[0] as { payload?: Requests; value?: Requests } | undefined;
  const requests = first?.payload?.actionRequests ?? first?.value?.actionRequests ?? [];
  return requests.map((request) => ({
    name: request.name ?? "未知工具",
    args: request.args ?? {},
  }));
}

export function createResearchSession() {
  const checkpointer = new MemorySaver();
  const agent = createStructuredResearchAgent({ checkpointer });
  const trace = new TraceWriter();

  const readThread = async (threadId: string) => {
    const saved = await checkpointer.get({ configurable: { thread_id: threadId } });
    return {
      messages: (saved?.channel_values.messages ?? []) as BaseMessage[],
      sources: (saved?.channel_values.sources ?? []) as Source[],
    };
  };

  const runTurn = async (
    { text, threadId, model }: TurnInput,
    { onEvent, approve }: TurnHandlers,
  ): Promise<TurnResult> => {
    await trace.write({ type: "user_message", threadId, data: { content: text, model } });
    const config = {
      configurable: { thread_id: threadId },
      context: { model },
      recursionLimit: 20,
    };
    let nextInput: Parameters<typeof agent.streamEvents>[0] = {
      messages: [{ role: "user", content: text }],
    };
    let reportAttempts = 0;

    try {
      while (true) {
        const stream = await agent.streamEvents(nextInput, { ...config, version: "v3" });

        const readMessages = async () => {
          for await (const message of stream.messages) {
            let wroteText = false;
            // The report arrives as tool-call arguments, keyed by content block index.
            const reports = new Map<number, { attempt: number; args: string }>();
            for await (const event of message) {
              if (event.event === "content-block-start") {
                const block = event.content;
                if (block.type === "tool_call_chunk" && block.name === RESEARCH_REPORT_TOOL) {
                  reports.set(event.index, { attempt: reportAttempts++, args: "" });
                }
              } else if (event.event === "content-block-delta") {
                const { delta } = event;
                if (delta.type === "tool-call-delta") {
                  const report = reports.get(event.index);
                  if (!report) continue;
                  report.args += delta.args;
                  const partial: unknown = parsePartialJson(report.args);
                  if (partial && typeof partial === "object") {
                    onEvent({ type: "report", attempt: report.attempt, report: partial, complete: false });
                  }
                } else if (delta.type === "text-delta") {
                  // The report-submitted ToolMessage is replayed on this stream as one chunk.
                  if (!wroteText && delta.text === REPORT_SUBMITTED_MESSAGE) break;
                  // glm can emit stray whitespace text next to the report tool call.
                  if (!wroteText && !delta.text.trim()) continue;
                  onEvent({ type: "text", text: delta.text, startsBlock: !wroteText });
                  wroteText = true;
                }
              } else if (event.event === "content-block-finish") {
                const block = event.content;
                const report = reports.get(event.index);
                if (report && block.type === "tool_call" && block.args && typeof block.args === "object") {
                  onEvent({ type: "report", attempt: report.attempt, report: block.args, complete: true });
                }
              }
            }
          }
        };

        const readToolCalls = async () => {
          for await (const call of stream.toolCalls) {
            onEvent({ type: "tool-start", id: call.callId, name: call.name, input: call.input });
            await trace.write({
              type: "tool_call",
              threadId,
              data: { name: call.name, input: call.input as unknown },
            });
            // A gated call may never settle in this run, so its result must not block the loop.
            void call.status.then(async (status) => {
              const ok = status !== "error";
              const detail = ok
                ? preview(await call.output)
                : ((await call.error) ?? "未知错误");
              onEvent({ type: "tool-end", id: call.callId, ok, detail });
            });
          }
        };

        await Promise.all([readMessages(), readToolCalls()]);

        if (stream.interrupted) {
          const actions = pendingActions(stream.interrupts as unknown[]);
          const approved = await approve(actions);
          nextInput = new Command({
            resume: {
              decisions: Array.from({ length: Math.max(actions.length, 1) }, () =>
                approved
                  ? { type: "approve" as const }
                  : { type: "reject" as const, message: "用户拒绝了该外部请求。" },
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
        const unverifiedUrls = findUnverifiedUrls(
          report ? reportText(report) : answer,
          (result.sources ?? []).map((source) => source.url),
        );
        await trace.write({
          type: "assistant_message",
          threadId,
          data: report ? { report, unverifiedUrls } : { answer, unverifiedUrls },
        });
        return { report, answer, unverifiedUrls };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await trace.write({ type: "error", threadId, data: { message } });
      throw error;
    }
  };

  return { trace, readThread, runTurn };
}

export type ResearchSession = ReturnType<typeof createResearchSession>;
