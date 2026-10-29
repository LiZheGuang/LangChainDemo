import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TraceWriter } from "../src/observability/trace.js";

describe("TraceWriter", () => {
  it("writes JSONL and redacts credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-trace-"));
    const writer = new TraceWriter(directory);

    await writer.write({
      type: "error",
      threadId: "thread-1",
      data: { apiKey: "secret", message: "token: abc123" },
    });

    const content = await readFile(join(directory, "thread-1.jsonl"), "utf8");
    expect(content).not.toContain("secret");
    expect(content).not.toContain("abc123");
    expect(JSON.parse(content)).toMatchObject({
      type: "error",
      threadId: "thread-1",
      data: { apiKey: "[REDACTED]" },
    });
  });
});
