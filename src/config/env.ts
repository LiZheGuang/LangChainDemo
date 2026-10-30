import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  MODEL_PROVIDER: z.enum(["ollama", "openai-compatible"]).default("ollama"),
  MODEL_NAME: z.string().min(1).default("qwen3:4b"),
  /** Extra models selectable at runtime, comma separated: `name` or `provider:name`. */
  MODEL_OPTIONS: z.string().optional(),
  OLLAMA_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  OPENAI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= envSchema.parse(process.env);
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = undefined;
}
