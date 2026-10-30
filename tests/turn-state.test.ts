import { describe, expect, it } from "vitest";
import { applyEvent, finishTurn, startTurn } from "../src/tui/turn-state.js";

describe("turn state", () => {
  it("merges text chunks, replaces report snapshots and settles tool calls", () => {
    let turn = startTurn("问题", "glm-5.2");
    turn = applyEvent(turn, { type: "text", text: "先", startsBlock: true });
    turn = applyEvent(turn, { type: "text", text: "查一下", startsBlock: false });
    turn = applyEvent(turn, { type: "tool-start", id: "1", name: "calculator", input: {} });
    turn = applyEvent(turn, { type: "tool-end", id: "1", ok: true, detail: "42" });
    turn = applyEvent(turn, { type: "report", attempt: 0, report: { summary: "4" }, complete: false });
    turn = applyEvent(turn, { type: "report", attempt: 0, report: { summary: "42" }, complete: true });
    turn = applyEvent(turn, { type: "report", attempt: 1, report: { summary: "重交" }, complete: false });

    expect(turn.blocks).toEqual([
      { kind: "text", text: "先查一下" },
      { kind: "tool", id: "1", name: "calculator", input: {}, status: "ok", detail: "42" },
      { kind: "report", attempt: 0, report: { summary: "42" }, complete: true },
      { kind: "report", attempt: 1, report: { summary: "重交" }, complete: false },
    ]);
  });

  it("falls back to the final answer when nothing was streamed", () => {
    const turn = finishTurn(startTurn("问题", "glm-5.2"), { answer: "直接回答", unverifiedUrls: [] });
    expect(turn.status).toBe("done");
    expect(turn.blocks).toEqual([{ kind: "text", text: "直接回答" }]);
  });
});
