import type { Decision } from "langchain";
import { useState } from "react";
import { useResearchStream } from "./agent.js";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { Composer } from "./components/Composer.js";
import { MessageList } from "./components/MessageList.js";
import { SourcesPanel } from "./components/SourcesPanel.js";
import { ThreadList } from "./components/ThreadList.js";

const THREAD_KEY = "research-assistant:thread-id";

const EXAMPLES = [
  "6 的 7 次方是多少？",
  "现在是几点？",
  "读一下 https://example.com 并总结",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [threadId, setThreadId] = useState<string | null>(() => localStorage.getItem(THREAD_KEY));
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalAttempt, setApprovalAttempt] = useState(0);

  const selectThread = (id: string | null) => {
    setThreadId(id);
    setActionError(null);
    if (id) localStorage.setItem(THREAD_KEY, id);
    else localStorage.removeItem(THREAD_KEY);
  };

  const stream = useResearchStream({
    threadId,
    onThreadId: selectThread,
    onCompleted: () => setRefreshKey((key) => key + 1),
  });

  const send = (text: string) => {
    setActionError(null);
    stream
      .submit({ messages: [{ type: "human", content: text }] })
      .catch((reason: unknown) => setActionError(errorMessage(reason)));
  };

  const respond = (decisions: Decision[]) => {
    setActionError(null);
    // Without an explicit id the SDK only resolves interrupts seen live in this
    // tab, not ones hydrated from thread history.
    const interruptId = stream.interrupt?.id;
    stream.respond({ decisions }, interruptId ? { interruptId } : undefined).catch((reason: unknown) => {
      setActionError(errorMessage(reason));
      setApprovalAttempt((attempt) => attempt + 1);
    });
  };

  const lastAi = stream.messages.findLast((message) => message.type === "ai");
  const pending = stream.interrupt?.value;
  const empty = stream.messages.length === 0 && !stream.isThreadLoading;
  const error = actionError ?? (stream.error ? errorMessage(stream.error) : null);

  return (
    <div className="layout">
      <ThreadList
        client={stream.client}
        activeId={threadId}
        refreshKey={refreshKey}
        onSelect={selectThread}
      />

      <main className="chat">
        <header className="chat-header">
          <h1>开发者研究助手</h1>
          <span className="muted small">LangChain createAgent · LangGraph Agent Server · @langchain/react</span>
        </header>

        <div className="chat-scroll">
          {empty ? (
            <div className="empty">
              <p>提问技术问题，助手会调用工具（计算、时间、搜索、读网页）并给出带来源的结论。</p>
              <div className="examples">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="chip" onClick={() => send(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList stream={stream} />
          )}
          {pending ? (
            <ApprovalCard
              key={`${stream.interrupt?.id}-${approvalAttempt}`}
              request={pending}
              onSubmit={respond}
            />
          ) : null}
          {error ? <div className="warning">运行出错：{error}</div> : null}
        </div>

        <Composer
          disabled={Boolean(pending)}
          isLoading={stream.isLoading && !pending}
          placeholder={pending ? "请先处理上面的审批" : "输入问题，Enter 发送，Shift+Enter 换行"}
          onSend={send}
          onStop={() => void stream.stop()}
        />
      </main>

      <SourcesPanel sources={stream.values.sources ?? []} lastAnswer={lastAi?.text ?? ""} />
    </div>
  );
}
