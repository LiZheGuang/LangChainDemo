import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createMiddleware } from "langchain";
import { z } from "zod";
import { createModelById } from "../config/model.js";

export const modelContextSchema = z.object({
  /** One of `listModelIds()`; omitted means the agent's default model. */
  model: z.string().optional(),
});

/**
 * Swaps the model for each call according to `context.model`, so one thread can
 * change models between turns while keeping its message history.
 */
export function createModelSwitchMiddleware(
  resolve: (id: string) => BaseChatModel = (id) => createModelById(id),
) {
  const models = new Map<string, BaseChatModel>();
  return createMiddleware({
    name: "ModelSwitch",
    contextSchema: modelContextSchema,
    wrapModelCall: (request, handler) => {
      const id = request.runtime.context?.model;
      if (!id) return handler(request);
      let model = models.get(id);
      if (!model) {
        model = resolve(id);
        models.set(id, model);
      }
      return handler({ ...request, model });
    },
  });
}
