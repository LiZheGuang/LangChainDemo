import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { getConfig } from "../config/env.js";

export interface ChatModelOverrides {
  provider?: "ollama" | "openai-compatible";
  model?: string;
  temperature?: number;
}

export function createChatModel(overrides: ChatModelOverrides = {}): BaseChatModel {
  const config = getConfig();
  const provider = overrides.provider ?? config.MODEL_PROVIDER;
  const model = overrides.model ?? config.MODEL_NAME;
  const temperature = overrides.temperature ?? config.MODEL_TEMPERATURE;

  if (provider === "ollama") {
    return new ChatOllama({
      model,
      baseUrl: config.OLLAMA_BASE_URL,
      temperature,
    });
  }

  if (!config.OPENAI_BASE_URL || !config.OPENAI_API_KEY) {
    throw new Error("openai-compatible provider requires OPENAI_BASE_URL and OPENAI_API_KEY");
  }

  return new ChatOpenAI({
    model,
    apiKey: config.OPENAI_API_KEY,
    configuration: { baseURL: config.OPENAI_BASE_URL },
    temperature,
    timeout: config.MODEL_TIMEOUT_MS,
  });
}
