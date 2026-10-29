import type { Client } from "@langchain/langgraph-sdk";
import { useEffect, useState } from "react";
import { ASSISTANT_ID } from "../agent.js";

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  interrupted: boolean;
}

interface ThreadListProps {
  client: Client;
  activeId: string | null;
  refreshKey: number;
  onSelect: (threadId: string | null) => void;
}

function titleOf(values: unknown): string | undefined {
  const messages = (values as { messages?: { content?: unknown }[] } | null)?.messages;
  const first = messages?.[0]?.content;
  if (typeof first === "string") return first;
  if (Array.isArray(first)) {
    return first
      .map((part: unknown) => (part as { text?: unknown }).text)
      .find((value): value is string => typeof value === "string");
  }
  return undefined;
}

async function loadThreads(client: Client, signal: AbortSignal): Promise<ThreadSummary[]> {
  const list = await client.threads.search({
    metadata: { graph_id: ASSISTANT_ID },
    limit: 30,
    sortBy: "updated_at",
    sortOrder: "desc",
    signal,
  });
  return Promise.all(
    list.map(async (thread) => {
      // Thread records only carry `values` for some run paths; fall back to the checkpoint.
      const title =
        titleOf(thread.values) ??
        titleOf((await client.threads.getState(thread.thread_id, undefined, { signal })).values);
      return {
        id: thread.thread_id,
        title: title ?? "新会话",
        updatedAt: thread.updated_at,
        interrupted: thread.status === "interrupted",
      };
    }),
  );
}

export function ThreadList({ client, activeId, refreshKey, onSelect }: ThreadListProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadThreads(client, controller.signal)
      .then((list) => {
        setError(null);
        setThreads(list);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String(reason));
      });
    return () => controller.abort();
  }, [client, activeId, refreshKey]);

  return (
    <nav className="threads">
      <button type="button" className="primary new-thread" onClick={() => onSelect(null)}>
        + 新会话
      </button>
      {error ? <p className="warning small">无法连接 Agent Server：{error}</p> : null}
      <ul>
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              className={`thread ${thread.id === activeId ? "thread-active" : ""}`}
              onClick={() => onSelect(thread.id)}
              title={thread.title}
            >
              <span className="thread-title">{thread.title}</span>
              <span className="muted small">
                {thread.interrupted ? "待审批 · " : ""}
                {new Date(thread.updatedAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
