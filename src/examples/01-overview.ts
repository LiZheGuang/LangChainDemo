import { AIMessage, createAgent, tool } from "langchain";
import * as z from "zod";
import { DEFAULT_SYSTEM_PROMPT } from "../config/prompts.js";
import { createChatModel } from "../models/createChatModel.js";

const getWeather = tool(
  (input) => `It's always sunny in ${input.city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string().describe("The city to get the weather for"),
    }),
  },
);

const agent = createAgent({
  model: createChatModel(),
  tools: [getWeather],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in San Francisco?" }],
});

for (const message of result.messages) {
  const toolCalls = AIMessage.isInstance(message) ? message.tool_calls : undefined;
  console.log(`[${message.type}]`, message.content || "", toolCalls?.length ? toolCalls : "");
}
