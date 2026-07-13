import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractRSSField,
  loadRSSFeeds,
  parseRssSourcesYaml,
} from "../workflows/rss-collector.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RSS_SOURCES_FILE = join(__dirname, "..", "pipeline", "rss_sources.yaml");

describe("parseRssSourcesYaml", () => {
  it("parses enabled sources from rss_sources.yaml", () => {
    const raw = readFileSync(RSS_SOURCES_FILE, "utf-8");
    const entries = parseRssSourcesYaml(raw);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.name === "腾讯技术工程")).toBe(true);
    expect(entries.some((e) => e.url?.includes("wechat2rss.bestblogs.dev"))).toBe(
      true,
    );
  });
});

describe("loadRSSFeeds", () => {
  it("filters disabled feeds and assigns slug", () => {
    const feeds = loadRSSFeeds();

    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.every((f) => f.slug && f.url)).toBe(true);
    expect(feeds.some((f) => f.name === "腾讯技术工程")).toBe(true);
    expect(feeds.some((f) => f.url.includes("wechat2rss.bestblogs.dev"))).toBe(
      true,
    );
  });
});

describe("extractRSSField", () => {
  it("extracts title and strips CDATA", () => {
    const block = "<title><![CDATA[Hello &amp; World]]></title>";
    expect(extractRSSField(block, /<title[^>]*>([\s\S]*?)<\/title>/i)).toBe(
      "Hello & World",
    );
  });

  it("extracts atom link href", () => {
    const block =
      '<link rel="alternate" type="text/html" href="https://example.com/post"/>';
    expect(extractRSSField(block, /<link[^>]*href="([^"]+)"/i)).toBe(
      "https://example.com/post",
    );
  });
});
