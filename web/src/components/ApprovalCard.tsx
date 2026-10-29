import type { Decision, HITLRequest } from "langchain";
import { useState } from "react";
import { rejectionMessage } from "./rejection.js";

interface ApprovalCardProps {
  request: HITLRequest;
  onSubmit: (decisions: Decision[]) => void;
}

type Choice = "approve" | "reject";

export function ApprovalCard({ request, onSubmit }: ApprovalCardProps) {
  const { actionRequests } = request;
  const [choices, setChoices] = useState<Choice[]>(() => actionRequests.map(() => "approve"));
  const [reasons, setReasons] = useState<string[]>(() => actionRequests.map(() => ""));

  const submit = () => {
    onSubmit(
      actionRequests.map((_, index): Decision =>
        choices[index] === "reject"
          ? { type: "reject", message: rejectionMessage(reasons[index] ?? "") }
          : { type: "approve" },
      ),
    );
  };

  const setAt = <T,>(list: T[], index: number, value: T) =>
    list.map((item, i) => (i === index ? value : item));

  return (
    <div className="approval">
      <div className="approval-title">需要你的审批（{actionRequests.length} 个工具调用）</div>
      {actionRequests.map((action, index) => (
        <div key={`${action.name}-${index}`} className="approval-item">
          <div className="approval-head">
            <span className="tool-name">{action.name}</span>
            <span className="approval-desc">{action.description}</span>
          </div>
          <pre>{JSON.stringify(action.args, null, 2)}</pre>
          <div className="approval-actions">
            {(["approve", "reject"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                className={`chip ${choices[index] === choice ? `chip-on chip-${choice}` : ""}`}
                onClick={() => setChoices((list) => setAt(list, index, choice))}
              >
                {choice === "approve" ? "批准" : "拒绝"}
              </button>
            ))}
            {choices[index] === "reject" ? (
              <input
                className="reason"
                placeholder="拒绝理由（会告诉模型）"
                value={reasons[index]}
                onChange={(event) => setReasons((list) => setAt(list, index, event.target.value))}
              />
            ) : null}
          </div>
        </div>
      ))}
      <button type="button" className="primary" onClick={submit}>
        提交决定并继续
      </button>
    </div>
  );
}
