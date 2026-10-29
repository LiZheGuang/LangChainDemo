import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "../config/env.js";

export interface TraceEvent {
  type:
    | "session_start"
    | "user_message"
    | "tool_call"
    | "assistant_message"
    | "error";
  threadId: string;
  data?: unknown;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      /(api[_-]?key|authorization|token)(["'=:\s]+)[^\s",}]+/gi,
      "$1$2[REDACTED]",
    );
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /key|token|authorization/i.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  }
  return value;
}

export class TraceWriter {
  constructor(private readonly directory = getConfig().TRACE_DIR) {}

  async write(event: TraceEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      ...event,
      data: redact(event.data),
    };
    await appendFile(
      join(this.directory, `${event.threadId}.jsonl`),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
  }
}
