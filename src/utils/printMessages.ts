import { AIMessage, type BaseMessage } from "langchain";

export function printMessages(messages: BaseMessage[]): void {
  for (const message of messages) {
    const toolCalls = AIMessage.isInstance(message) ? message.tool_calls : undefined;
    console.log(`[${message.type}]`, message.text, toolCalls?.length ? toolCalls : "");
  }
}

export function printSection(title: string): void {
  console.log(`\n========== ${title} ==========`);
}
