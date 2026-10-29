import { tool } from "langchain";
import { z } from "zod";

export const calculatorTool = tool(
  ({ left, operator, right }) => {
    switch (operator) {
      case "add":
        return { result: left + right };
      case "subtract":
        return { result: left - right };
      case "multiply":
        return { result: left * right };
      case "divide":
        if (right === 0) throw new Error("不能除以 0");
        return { result: left / right };
      case "power":
        return { result: left ** right };
    }
  },
  {
    name: "calculator",
    description: "执行两个数字之间的精确算术运算。",
    schema: z.object({
      left: z.number().describe("左操作数"),
      operator: z
        .enum(["add", "subtract", "multiply", "divide", "power"])
        .describe("运算类型"),
      right: z.number().describe("右操作数"),
    }),
  },
);
