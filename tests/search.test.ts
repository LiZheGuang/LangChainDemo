import { describe, expect, it } from "vitest";
import { mergeSources } from "../src/agent/sources-state.js";
import {
  createSearchTool,
  type SearchProvider,
} from "../src/tools/search.js";

describe("search tool", () => {
  it("returns provider results when invoked outside an agent run", async () => {
    const provider: SearchProvider = {
      name: "fake",
      search(query, limit) {
        expect(query).toBe("LangChain tools");
        expect(limit).toBe(2);
        return Promise.resolve([
          { title: "Tools", url: "https://example.com/tools", snippet: "Tool docs" },
        ]);
      },
    };
    const search = createSearchTool(provider);

    const result = await search.invoke({ query: "LangChain tools", limit: 2 });

    expect(result).toMatchObject({ provider: "fake", results: [{ title: "Tools" }] });
  });
});

describe("mergeSources", () => {
  it("deduplicates by URL and keeps the latest title", () => {
    expect(
      mergeSources(
        [{ title: "Old", url: "https://example.com/a" }],
        [
          { title: "New", url: "https://example.com/a" },
          { title: "B", url: "https://example.com/b" },
        ],
      ),
    ).toEqual([
      { title: "New", url: "https://example.com/a" },
      { title: "B", url: "https://example.com/b" },
    ]);
  });
});
