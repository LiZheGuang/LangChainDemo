import type { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import { fetchPage } from "../src/tools/fetch-page.js";

const publicLookup = vi.fn(() =>
  Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]),
) as unknown as typeof lookup;

describe("fetchPage", () => {
  it("extracts readable content and removes scripts", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(
          "<html><head><title>Docs</title></head><body><main>Hello <script>bad()</script>world</main></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      ),
    ) as unknown as typeof fetch;

    await expect(
      fetchPage("https://example.com/docs", {
        fetchImpl,
        lookupHost: publicLookup,
      }),
    ).resolves.toEqual({
      url: "https://example.com/docs",
      title: "Docs",
      text: "Hello world",
    });
  });

  it("blocks private network targets before fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      fetchPage("http://127.0.0.1/admin", { fetchImpl }),
    ).rejects.toThrow("禁止访问本机或内网地址");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the response size limit", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response("too large", {
          headers: {
            "content-type": "text/plain",
            "content-length": "9",
          },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(
      fetchPage("https://example.com/file", {
        fetchImpl,
        lookupHost: publicLookup,
        maxBytes: 4,
      }),
    ).rejects.toThrow("页面超过 4 字节限制");
  });
});
