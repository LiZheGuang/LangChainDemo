import type { BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createResearchAgent } from "../src/agent/create-research-agent.js";
import { createModel, diagnoseModel } from "../src/config/model.js";
import { parseResearchReport } from "../src/schemas/research-report.js";

console.log("diagnose:", await diagnoseModel());

const model = createModel();
const reply = await model.invoke("Say hello in one sentence.");
console.log("invoke:", reply.text);

const agent = createResearchAgent({ checkpointer: new MemorySaver() });
const stream = await agent.streamEvents(
  { messages: [{ role: "user", content: "2 的 20 次方是多少？请用计算器，不要搜索。" }] },
  { configurable: { thread_id: "smoke" }, version: "v3" },
);

let chunks = 0;
process.stdout.write("agent stream:\n");
for await (const message of stream.messages) {
  for await (const token of message.text) {
    chunks += 1;
    process.stdout.write(token);
  }
}
process.stdout.write("\n");

const output = (await stream.output) as { messages?: BaseMessage[] };
const messages = output.messages ?? [];
const toolNames = messages.flatMap((message) =>
  "tool_calls" in message && Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call: { name: string }) => call.name)
    : [],
);
console.log("streamed chunks:", chunks);
console.log("agent tool calls:", toolNames);
console.log("parsed report:", parseResearchReport(messages.at(-1)?.text ?? ""));
