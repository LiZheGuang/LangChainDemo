import { findUnverifiedUrls } from "../../../src/evaluation/evaluate-report.js";
import type { Source } from "../../../src/agent/sources-state.js";

interface SourcesPanelProps {
  sources: Source[];
  lastAnswer: string;
}

export function SourcesPanel({ sources, lastAnswer }: SourcesPanelProps) {
  const unverified = lastAnswer
    ? findUnverifiedUrls(lastAnswer, sources.map((source) => source.url))
    : [];

  return (
    <aside className="sources">
      <h2>本会话来源</h2>
      {sources.length === 0 ? (
        <p className="muted">还没有读取任何网页。工具执行后，来源会写入 thread 状态并显示在这里。</p>
      ) : (
        <ol>
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.title || source.url}
              </a>
              <div className="muted url">{source.url}</div>
            </li>
          ))}
        </ol>
      )}
      {unverified.length > 0 ? (
        <div className="warning">
          <strong>未经工具验证的链接</strong>
          <p className="muted">最新回答引用了以下链接，但本会话的工具从未访问过它们：</p>
          <ul>
            {unverified.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
