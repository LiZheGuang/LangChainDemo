import { describe, expect, it } from "vitest";
import { calculatorTool } from "../src/tools/calculator.js";
import { currentTimeTool } from "../src/tools/current-time.js";

describe("deterministic tools", () => {
  it("calculates with structured operands", async () => {
    await expect(
      calculatorTool.invoke({ left: 6, operator: "multiply", right: 7 }),
    ).resolves.toEqual({ result: 42 });
  });

  it("rejects division by zero", async () => {
    await expect(
      calculatorTool.invoke({ left: 1, operator: "divide", right: 0 }),
    ).rejects.toThrow("不能除以 0");
  });

  it("returns an ISO timestamp and requested timezone", async () => {
    const result = await currentTimeTool.invoke({ timeZone: "Asia/Shanghai" });
    expect(result.timeZone).toBe("Asia/Shanghai");
    expect(new Date(result.iso).toString()).not.toBe("Invalid Date");
  });
});
