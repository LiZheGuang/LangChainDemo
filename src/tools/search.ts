import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";
import { resultWithSources } from "../agent/sources-state.js";
import type { AppConfig } from "../config/env.js";
import { getConfig } from "../config/env.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

class ManualSearchProvider implements SearchProvider {
  readonly name = "manual";

  search(): Promise<SearchResult[]> {
    return Promise.resolve([]);
  }
}

class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";

  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": this.apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Brave Search 返回 HTTP ${response.status}`);
    const payload = (await response.json()) as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };
    return (payload.web?.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }
}

class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: limit,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Tavily 返回 HTTP ${response.status}`);
    const payload = (await response.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };
    return (payload.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
    }));
  }
}

export function createSearchProvider(config: AppConfig = getConfig()): SearchProvider {
  if (config.SEARCH_PROVIDER === "brave") {
    if (!config.BRAVE_SEARCH_API_KEY) {
      throw new Error("SEARCH_PROVIDER=brave 时必须配置 BRAVE_SEARCH_API_KEY");
    }
    return new BraveSearchProvider(config.BRAVE_SEARCH_API_KEY);
  }
  if (config.SEARCH_PROVIDER === "tavily") {
    if (!config.TAVILY_API_KEY) {
      throw new Error("SEARCH_PROVIDER=tavily 时必须配置 TAVILY_API_KEY");
    }
    return new TavilySearchProvider(config.TAVILY_API_KEY);
  }
  return new ManualSearchProvider();
}

export function createSearchTool(provider = createSearchProvider()) {
  return tool(
    async ({ query, limit }, runtime: ToolRuntime) => {
      const results = await provider.search(query, limit);
      const result =
        provider.name === "manual"
          ? {
              provider: "manual",
              results,
              message:
                "未配置自动搜索服务。请让用户提供相关 URL，然后使用 fetch_page 阅读。",
            }
          : { provider: provider.name, results };
      return resultWithSources(
        result,
        results.map(({ title, url }) => ({ title, url })),
        { name: "web_search", id: runtime.toolCallId },
      );
    },
    {
      name: "web_search",
      description: "搜索开发资料并返回标题、URL 和摘要。",
      schema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(10).default(5),
      }),
    },
  );
}
