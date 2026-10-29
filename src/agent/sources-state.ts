import { Command } from "@langchain/langgraph";
import { registry } from "@langchain/langgraph/zod";
import { createMiddleware, ToolMessage } from "langchain";
import { z } from "zod";

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export type Source = z.infer<typeof sourceSchema>;

export function mergeSources(current: Source[], incoming: Source[]): Source[] {
  const byUrl = new Map(current.map((source) => [source.url, source]));
  for (const source of incoming) byUrl.set(source.url, source);
  return [...byUrl.values()];
}

// A plain Zod object (rather than StateSchema) lets `useStream<typeof agent>`
// infer `sources` on the frontend; the reducer lives in LangGraph's registry.
export const SourcesState = z.object({
  sources: z
    .array(sourceSchema)
    .default(() => [])
    .register(registry, {
      reducer: { schema: z.array(sourceSchema), fn: mergeSources },
      default: () => [],
    }),
});

export const sourcesMiddleware = createMiddleware({
  name: "SourcesState",
  stateSchema: SourcesState,
});

/**
 * Outside an agent run there is no tool call to answer, so the plain result is
 * returned; inside a run the ToolMessage is mandatory because every tool call
 * in the history needs a matching response.
 */
export function resultWithSources<T>(
  result: T,
  sources: Source[],
  toolCall: { name: string; id: string | undefined },
): T | Command {
  if (!toolCall.id) return result;
  return new Command({
    update: {
      sources,
      messages: [
        new ToolMessage({
          content: JSON.stringify(result),
          name: toolCall.name,
          tool_call_id: toolCall.id,
        }),
      ],
    },
  });
}
