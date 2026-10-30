import { load } from "@langchain/core/load";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  tool,
  type ContentBlock,
} from "langchain";
import * as z from "zod";
import { createChatModel } from "../models/createChatModel.js";
import { printSection } from "../utils/printMessages.js";

const model = createChatModel();

/** 三种输入格式：字符串、消息对象、字典（OpenAI 格式） */
async function inputs() {
  printSection("三种输入格式");

  const fromString = await model.invoke("用一句话介绍春天");
  console.log("字符串:", fromString.text);

  const fromMessages = await model.invoke([
    new SystemMessage("你是一位诗人，用简体中文回答"),
    new HumanMessage("写一句关于春天的诗"),
  ]);
  console.log("消息对象:", fromMessages.text);

  const fromDicts = await model.invoke([
    { role: "system", content: "你是一位诗人，用简体中文回答" },
    { role: "user", content: "写一句关于秋天的诗" },
  ]);
  console.log("字典格式:", fromDicts.text);
}

/** 四种消息类型：System / Human / AI / Tool，以及手动插入 AIMessage */
async function types() {
  printSection("消息类型 + 手动插入 AIMessage");

  const human = new HumanMessage({ content: "你好！", name: "alice", id: "msg_123" });
  console.log("HumanMessage 元数据:", { name: human.name, id: human.id, type: human.type });

  const response = await model.invoke([
    new SystemMessage("你是一个乐于助人的助手，用简体中文回答"),
    new HumanMessage("你能帮我吗？"),
    new AIMessage("当然可以！不过我只用一个字回答问题。"),
    new HumanMessage("天空是什么颜色？"),
  ]);
  console.log("回答:", response.text);
}

/** AIMessage 的属性：text、content、contentBlocks、id、usage_metadata、response_metadata */
async function aiAttributes() {
  printSection("AIMessage 属性");
  const response = await model.invoke("用一句话解释什么是 AI");

  console.log("类型:", response.constructor.name);
  console.log("text:", response.text);
  console.log("content:", response.content);
  console.log("contentBlocks:", response.contentBlocks);
  console.log("id:", response.id);
  console.log("usage_metadata:", (response as AIMessage).usage_metadata);
  console.log("response_metadata:", response.response_metadata);
}

/** 工具调用：手动完成 AIMessage(tool_calls) -> ToolMessage -> AIMessage 的循环 */
async function toolCalls() {
  printSection("工具调用（手动循环）");
  const getWeather = tool(({ city }) => `${city}：晴，22°C`, {
    name: "get_weather",
    description: "查询指定城市的天气",
    schema: z.object({ city: z.string() }),
  });

  if (!model.bindTools) throw new Error("当前模型不支持工具调用");
  const modelWithTools = model.bindTools([getWeather]);

  const question = new HumanMessage("巴黎天气怎么样？");
  const aiMessage = (await modelWithTools.invoke([question])) as AIMessage;
  for (const call of aiMessage.tool_calls ?? []) {
    console.log(`模型想调用: ${call.name}`, call.args, `id=${call.id}`);
  }

  const toolMessages = await Promise.all(
    (aiMessage.tool_calls ?? []).map(async (call) => {
      const output = await getWeather.invoke(call.args as { city: string });
      return new ToolMessage({ content: output, tool_call_id: call.id!, name: call.name });
    }),
  );

  const final = await modelWithTools.invoke([question, aiMessage, ...toolMessages]);
  console.log("最终回答:", final.text);
}

/** ToolMessage 的 artifact：给程序用、不发给模型的附加数据 */
async function artifact() {
  printSection("ToolMessage.artifact");
  const toolMessage = new ToolMessage({
    content: "那是最好的时代，也是最坏的时代。",
    tool_call_id: "call_123",
    name: "search_books",
    artifact: { document_id: "doc_123", page: 0 },
  });
  console.log("content（发给模型）:", toolMessage.content);
  console.log("artifact（只给程序）:", toolMessage.artifact);
}

/** 流式：AIMessageChunk 逐块到达，用 concat 拼成完整消息 */
async function streaming() {
  printSection("流式 + AIMessageChunk");
  let full: AIMessageChunk | undefined;
  const stream = await model.stream("数到 5，用中文");
  for await (const chunk of stream) {
    process.stdout.write(chunk.text);
    full = full ? full.concat(chunk) : chunk;
  }
  console.log("\n拼接后的完整消息:", full?.text);
}

/** 标准内容块：不同厂商的原始格式，统一解析成 contentBlocks */
async function contentBlocks() {
  printSection("标准内容块 contentBlocks");
  const anthropic = new AIMessage({
    content: [
      { type: "thinking", thinking: "用户在打招呼……", signature: "WaUjzkyp..." },
      { type: "text", text: "你好！" },
    ],
    response_metadata: { model_provider: "anthropic" },
  });

  const openai = new AIMessage({
    content: [
      { type: "reasoning", id: "rs_abc123", summary: [{ type: "summary_text", text: "用户在打招呼……" }] },
      { type: "text", text: "你好！" },
    ],
    response_metadata: { model_provider: "openai" },
  });

  console.log("Anthropic 原始 content:", JSON.stringify(anthropic.content));
  console.log("Anthropic contentBlocks:", JSON.stringify(anthropic.contentBlocks));
  console.log("OpenAI 原始 content:", JSON.stringify(openai.content));
  console.log("OpenAI contentBlocks:", JSON.stringify(openai.contentBlocks));
}

/** 多模态：用标准内容块构造图片消息（是否能调用取决于模型是否支持视觉） */
async function multimodal() {
  printSection("多模态消息");
  const textBlock: ContentBlock.Text = { type: "text", text: "描述这张图片的内容" };
  const imageBlock: ContentBlock.Multimodal.Image = {
    type: "image",
    url: "https://example.com/image.png",
    mimeType: "image/png",
  };

  const message = new HumanMessage({ contentBlocks: [textBlock, imageBlock] });
  console.log("多模态消息 contentBlocks:", message.contentBlocks);
}

/** 序列化：toJSON 存储，load 还原 */
async function serialization() {
  printSection("序列化与反序列化");
  const message = new HumanMessage("法国的首都是哪里？");
  const serialized = JSON.stringify(message.toJSON());
  console.log("序列化:", serialized);

  const restored = await load<HumanMessage>(serialized);
  console.log("还原后类型:", restored.constructor.name, "| 内容:", restored.text);
}

const sections = {
  inputs,
  types,
  aiAttributes,
  toolCalls,
  artifact,
  streaming,
  contentBlocks,
  multimodal,
  serialization,
};
type SectionName = keyof typeof sections;

const selected = process.argv[2] as SectionName | undefined;
if (selected && !(selected in sections)) {
  console.error(`未知示例：${selected}，可选：${Object.keys(sections).join(", ")}`);
  process.exit(1);
}

for (const [name, run] of Object.entries(sections)) {
  if (!selected || selected === name) await run();
}
