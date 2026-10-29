import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import {
  createModel,
  createModelById,
  diagnoseModel,
  listModelIds,
  modelConfig,
} from "../src/config/model.js";

const baseConfig: AppConfig = {
  MODEL_PROVIDER: "ollama",
  MODEL_NAME: "test-model",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  MODEL_TEMPERATURE: 0,
  MODEL_TIMEOUT_MS: 1_000,
  SEARCH_PROVIDER: "manual",
  TRACE_DIR: ".data/traces",
  FETCH_TIMEOUT_MS: 1_000,
  FETCH_MAX_BYTES: 1_000,
};

describe("createModel", () => {
  it("uses Ollama by default", () => {
    expect(createModel(baseConfig)).toBeInstanceOf(ChatOllama);
  });

  it("uses ChatOpenAI for an OpenAI-compatible endpoint", () => {
    const model = createModel({
      ...baseConfig,
      MODEL_PROVIDER: "openai-compatible",
      OPENAI_BASE_URL: "http://example.test/v1/",
      OPENAI_API_KEY: "test-key",
    });

    expect(model).toBeInstanceOf(ChatOpenAI);
    expect((model as ChatOpenAI).model).toBe("test-model");
  });

  it("requires base URL and API key for OpenAI-compatible mode", async () => {
    const config: AppConfig = {
      ...baseConfig,
      MODEL_PROVIDER: "openai-compatible",
    };

    expect(() => createModel(config)).toThrow("OPENAI_BASE_URL");
    await expect(diagnoseModel(config)).resolves.toMatchObject({ ok: false });
  });
});

describe("model selection", () => {
  const config: AppConfig = {
    ...baseConfig,
    MODEL_PROVIDER: "openai-compatible",
    MODEL_NAME: "glm-5.2",
    MODEL_OPTIONS: "glm-4.5-air, ollama:qwen3:4b, openai-compatible:glm-5.2",
    OPENAI_BASE_URL: "http://example.test/v1",
    OPENAI_API_KEY: "test-key",
  };

  it("lists the default model first and normalizes provider prefixes", () => {
    expect(listModelIds(config)).toEqual(["glm-5.2", "glm-4.5-air", "ollama:qwen3:4b"]);
  });

  it("keeps colons inside Ollama model names", () => {
    expect(modelConfig("ollama:qwen3:4b", config)).toMatchObject({
      MODEL_PROVIDER: "ollama",
      MODEL_NAME: "qwen3:4b",
    });
    expect(modelConfig("qwen3:4b", baseConfig)).toMatchObject({
      MODEL_PROVIDER: "ollama",
      MODEL_NAME: "qwen3:4b",
    });
  });

  it("creates only allowlisted models", () => {
    expect(createModelById("ollama:qwen3:4b", config)).toBeInstanceOf(ChatOllama);
    expect(createModelById("glm-4.5-air", config)).toBeInstanceOf(ChatOpenAI);
    expect(() => createModelById("gpt-5", config)).toThrow("未配置的模型");
  });
});
