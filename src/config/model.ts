import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { getConfig, type AppConfig } from "./env.js";

function requireOpenAIConfig(config: AppConfig): {
  apiKey: string;
  baseURL: string;
} {
  if (!config.OPENAI_BASE_URL || !config.OPENAI_API_KEY) {
    throw new Error(
      "MODEL_PROVIDER=openai-compatible 时必须配置 OPENAI_BASE_URL 和 OPENAI_API_KEY",
    );
  }
  return {
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL.replace(/\/+$/, ""),
  };
}

export function createModel(config: AppConfig = getConfig()): BaseChatModel {
  if (config.MODEL_PROVIDER === "openai-compatible") {
    const { apiKey, baseURL } = requireOpenAIConfig(config);
    return new ChatOpenAI({
      model: config.MODEL_NAME,
      apiKey,
      configuration: { baseURL },
      temperature: config.MODEL_TEMPERATURE,
      timeout: config.MODEL_TIMEOUT_MS,
      maxRetries: 1,
      useResponsesApi: false,
    });
  }

  return new ChatOllama({
    model: config.MODEL_NAME,
    baseUrl: config.OLLAMA_BASE_URL,
    temperature: config.MODEL_TEMPERATURE,
    maxRetries: 1,
  });
}

const PROVIDERS = ["ollama", "openai-compatible"] as const;

/**
 * Resolves a model id to the config that creates it. An id is a bare model name
 * on the default provider, or `provider:name` (e.g. `ollama:qwen3:4b`).
 */
export function modelConfig(id: string, config: AppConfig = getConfig()): AppConfig {
  const colon = id.indexOf(":");
  const provider = PROVIDERS.find((name) => colon > 0 && id.slice(0, colon) === name);
  return provider
    ? { ...config, MODEL_PROVIDER: provider, MODEL_NAME: id.slice(colon + 1) }
    : { ...config, MODEL_NAME: id };
}

function modelId(config: AppConfig, defaults: AppConfig): string {
  return config.MODEL_PROVIDER === defaults.MODEL_PROVIDER
    ? config.MODEL_NAME
    : `${config.MODEL_PROVIDER}:${config.MODEL_NAME}`;
}

/** The default model first, then `MODEL_OPTIONS`; only these may be selected at runtime. */
export function listModelIds(config: AppConfig = getConfig()): string[] {
  const options = (config.MODEL_OPTIONS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => modelId(modelConfig(id, config), config));
  return [...new Set([config.MODEL_NAME, ...options])];
}

export function createModelById(id: string, config: AppConfig = getConfig()): BaseChatModel {
  const ids = listModelIds(config);
  if (!ids.includes(id)) {
    throw new Error(`未配置的模型：${id}。可选：${ids.join(", ")}`);
  }
  return createModel(modelConfig(id, config));
}

export interface ModelDiagnostic {
  ok: boolean;
  message: string;
}

async function diagnoseOpenAICompatible(
  config: AppConfig,
): Promise<ModelDiagnostic> {
  let settings: { apiKey: string; baseURL: string };
  try {
    settings = requireOpenAIConfig(config);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const response = await fetch(`${settings.baseURL}/models`, {
      headers: { authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "模型服务拒绝了 API Key，请检查 OPENAI_API_KEY。" };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `模型服务 /models 返回 HTTP ${response.status}，可直接尝试对话确认 chat/completions 是否可用。`,
      };
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = payload.data?.map((item) => item.id).filter(Boolean) ?? [];
    if (ids.length > 0 && !ids.includes(config.MODEL_NAME)) {
      return {
        ok: false,
        message: `服务可连接，但模型列表中没有 ${config.MODEL_NAME}。`,
      };
    }
    return {
      ok: true,
      message: `OpenAI-compatible 模型 ${config.MODEL_NAME} 已就绪。`,
    };
  } catch {
    return {
      ok: false,
      message: `无法连接 ${settings.baseURL}，请检查网络、VPN 或 OPENAI_BASE_URL。`,
    };
  }
}

async function diagnoseOllama(config: AppConfig): Promise<ModelDiagnostic> {
  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Ollama 返回 HTTP ${response.status}。请确认服务正常运行。`,
      };
    }

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const names = payload.models?.flatMap((item) =>
      [item.name, item.model].filter((name): name is string => Boolean(name)),
    );
    const installed = names?.some(
      (name) =>
        name === config.MODEL_NAME ||
        name.startsWith(`${config.MODEL_NAME}:`) ||
        config.MODEL_NAME.startsWith(`${name}:`),
    );

    return installed
      ? { ok: true, message: `本地模型 ${config.MODEL_NAME} 已就绪。` }
      : {
          ok: false,
          message: `未找到 ${config.MODEL_NAME}，请运行：ollama pull ${config.MODEL_NAME}`,
        };
  } catch {
    return {
      ok: false,
      message: "无法连接 Ollama。请先安装并启动 Ollama（ollama serve）。",
    };
  }
}

export async function diagnoseModel(
  config: AppConfig = getConfig(),
): Promise<ModelDiagnostic> {
  return config.MODEL_PROVIDER === "openai-compatible"
    ? diagnoseOpenAICompatible(config)
    : diagnoseOllama(config);
}
