export type ToolCardStatus = "awaiting" | "running" | "finished" | "error" | "rejected";

export interface ToolCardProps {
  name: string;
  args: unknown;
  status: ToolCardStatus;
  output?: unknown;
  error?: string | undefined;
}

const STATUS_LABEL: Record<ToolCardStatus, string> = {
  awaiting: "等待审批",
  running: "执行中",
  finished: "完成",
  error: "失败",
  rejected: "已拒绝",
};

function preview(value: unknown, max = 600): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ToolCallCard({ name, args, status, output, error }: ToolCardProps) {
  return (
    <details className={`tool-card tool-${status}`}>
      <summary>
        <span className="tool-dot" />
        <span className="tool-name">{name}</span>
        <code className="tool-args">{preview(args, 80)}</code>
        <span className="tool-status">{STATUS_LABEL[status]}</span>
      </summary>
      <div className="tool-body">
        <div className="tool-label">输入</div>
        <pre>{preview(args)}</pre>
        {(status === "error" || status === "rejected") && error ? (
          <>
            <div className="tool-label">{status === "rejected" ? "拒绝理由" : "错误"}</div>
            <pre>{error}</pre>
          </>
        ) : output !== undefined && output !== null ? (
          <>
            <div className="tool-label">输出</div>
            <pre>{preview(output)}</pre>
          </>
        ) : null}
      </div>
    </details>
  );
}
