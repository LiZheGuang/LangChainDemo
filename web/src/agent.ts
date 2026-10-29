import { useStream } from "@langchain/react";
import type { HITLRequest } from "langchain";
import type { agent } from "../../src/agent/graph.js";

export const API_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? `${window.location.origin}/api`;

/** Must match the graph id in langgraph.json. */
export const ASSISTANT_ID = "research";

interface ResearchStreamOptions {
  threadId: string | null;
  onThreadId: (threadId: string) => void;
  onCompleted: () => void;
}

export function useResearchStream(options: ResearchStreamOptions) {
  return useStream<typeof agent, HITLRequest>({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    ...options,
  });
}

export type ResearchStream = ReturnType<typeof useResearchStream>;
