import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { useEffect, useRef } from "react";
import type { ResearchStream } from "../agent.js";
import { Markdown } from "./Markdown.js";
import { isRejection } from "./rejection.js";
import { ToolCallCard, type ToolCardStatus } from "./ToolCallCard.js";

function reasoningOf(message: AIMessage): string {
  const fromBlocks = message.contentBlocks
    .flatMap((block) => (block.type === "reasoning" ? [block.reasoning] : []))
    .join("");
  if (fromBlocks) return fromBlocks;
  const raw: unknown = message.additional_kwargs.reasoning_content;
  return typeof raw === "string" ? raw : "";
}

function approvalKey(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args)}`;
}

export function MessageList({ stream }: { stream: ResearchStream }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages: BaseMessage[] = stream.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, stream.toolCalls, stream.interrupt]);

  const toolResults = new Map<string, ToolMessage>();
  for (const message of messages) {
    if (ToolMessage.isInstance(message)) toolResults.set(message.tool_call_id, message);
  }
  const liveCalls = new Map(stream.toolCalls.map((call) => [call.callId, call]));
  const awaiting = new Set(
    (stream.interrupt?.value?.actionRequests ?? []).map((request) =>
      approvalKey(request.name, request.args),
    ),
  );

  const last = messages.at(-1);
  const thinking = stream.isLoading && !stream.interrupt && (!last || last.type === "human");

  return (
    <div className="messages">
      {messages.map((message, index) => {
        const key = message.id ?? `${message.type}-${index}`;
        if (message.type === "human") {
          return (
            <div key={key} className="bubble bubble-human">
              {message.text}
            </div>
          );
        }
        if (!AIMessage.isInstance(message)) return null;

        const reasoning = reasoningOf(message);
        const text = message.text;
        return (
          <div key={key} className="bubble bubble-ai">
            {reasoning ? (
              <details className="reasoning">
                <summary>推理过程</summary>
                <div className="reasoning-body">{reasoning}</div>
              </details>
            ) : null}
            {message.tool_calls?.map((toolCall) => {
              const id = toolCall.id ?? "";
              const live = liveCalls.get(id);
              const result = toolResults.get(id);
              // The stored ToolMessage wins: a rejected call never ran, yet the live
              // stream still reports it as "finished".
              let status: ToolCardStatus = "running";
              if (result?.status === "error") status = isRejection(result.text) ? "rejected" : "error";
              else if (result) status = "finished";
              else if (live) status = live.status;
              else if (awaiting.has(approvalKey(toolCall.name, toolCall.args))) status = "awaiting";
              return (
                <ToolCallCard
                  key={id || toolCall.name}
                  name={toolCall.name}
                  args={toolCall.args}
                  status={status}
                  output={live?.output ?? result?.text}
                  error={live?.error ?? (result?.status === "error" ? result.text : undefined)}
                />
              );
            })}
            {text ? <Markdown text={text} /> : null}
          </div>
        );
      })}
      {thinking ? <div className="bubble bubble-ai thinking">思考中…</div> : null}
      <div ref={bottomRef} />
    </div>
  );
}
