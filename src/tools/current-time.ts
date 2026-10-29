import { tool } from "langchain";
import { z } from "zod";

export const currentTimeTool = tool(
  ({ timeZone }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      formatted: new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone,
      }).format(now),
      timeZone,
    };
  },
  {
    name: "current_time",
    description: "获取指定 IANA 时区的当前日期和时间。",
    schema: z.object({
      timeZone: z.string().default("Asia/Shanghai"),
    }),
  },
);
