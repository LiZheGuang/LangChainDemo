import type { ApprovalAction, TurnEvent, TurnResult } from "../session/research-session.js";

export type TurnBlock =
  | { kind: "text"; text: string }
  | { kind: "report"; attempt: number; report: object; complete: boolean }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "ok" | "error"; detail?: string }
  | { kind: "approval"; actions: ApprovalAction[]; approved: boolean };

export interface TurnState {
  question: string;
  model: string;
  blocks: TurnBlock[];
  status: "running" | "done" | "error";
  unverifiedUrls: string[];
  error?: string;
}

export function startTurn(question: string, model: string): TurnState {
  return { question, model, blocks: [], status: "running", unverifiedUrls: [] };
}

export function applyEvent(turn: TurnState, event: TurnEvent): TurnState {
  const blocks = [...turn.blocks];
  if (event.type === "text") {
    const last = blocks.at(-1);
    if (!event.startsBlock && last?.kind === "text") {
      blocks[blocks.length - 1] = { ...last, text: last.text + event.text };
    } else {
      blocks.push({ kind: "text", text: event.text });
    }
  } else if (event.type === "report") {
    const index = blocks.findIndex(
      (block) => block.kind === "report" && block.attempt === event.attempt,
    );
    const block = { kind: "report" as const, attempt: event.attempt, report: event.report, complete: event.complete };
    if (index === -1) blocks.push(block);
    else blocks[index] = block;
  } else if (event.type === "tool-start") {
    blocks.push({ kind: "tool", id: event.id, name: event.name, input: event.input, status: "running" });
  } else {
    const index = blocks.findIndex((block) => block.kind === "tool" && block.id === event.id);
    const block = blocks[index];
    if (block?.kind === "tool") {
      blocks[index] = { ...block, status: event.ok ? "ok" : "error", detail: event.detail };
    }
  }
  return { ...turn, blocks };
}

export function recordApproval(turn: TurnState, actions: ApprovalAction[], approved: boolean): TurnState {
  return { ...turn, blocks: [...turn.blocks, { kind: "approval", actions, approved }] };
}

/** Fills in whatever the stream did not show, e.g. a report that never streamed. */
export function finishTurn(turn: TurnState, result: TurnResult): TurnState {
  const blocks = [...turn.blocks];
  const hasReport = blocks.some((block) => block.kind === "report");
  const hasText = blocks.some((block) => block.kind === "text");
  if (result.report && !hasReport) {
    blocks.push({ kind: "report", attempt: 0, report: result.report, complete: true });
  } else if (!result.report && !hasText) {
    blocks.push({ kind: "text", text: result.answer || "（模型没有返回内容）" });
  }
  return { ...turn, blocks, status: "done", unverifiedUrls: result.unverifiedUrls };
}

export function failTurn(turn: TurnState, error: unknown): TurnState {
  return { ...turn, status: "error", error: error instanceof Error ? error.message : String(error) };
}
