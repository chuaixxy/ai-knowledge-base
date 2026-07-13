/**
 * RSS 采集 — 从 pipeline/rss_sources.yaml 读取订阅源并解析 feed
 *
 * 逻辑与 v3/pipeline/pipeline.ts 的 collectRSS / parseFeed 对齐。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RSS_SOURCES_FILE = join(__dirname, "..", "pipeline", "rss_sources.yaml");

export interface RSSFeedConfig {
  slug: string;
  name: string;
  url: string;
  category?: string;
  limit?: number;
}

interface YamlSourceEntry {
  name: string;
  url: string;
  category?: string;
  enabled?: boolean;
  limit?: number;
}

const BUILTIN_RSS_FEEDS: RSSFeedConfig[] = [
  {
    slug: "arxiv-cs-ai",
    name: "arXiv cs.AI",
    url: "https://rss.arxiv.org/rss/cs.AI",
    category: "research",
  },
  {
    slug: "huggingface",
    name: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
    category: "open-source",
  },
];

function parseScalar(raw: string): string | number | boolean {
  const value = raw
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (value !== "" && !Number.isNaN(num)) return num;
  return value;
}

/** 解析 rss_sources.yaml 中的 sources 列表（无需外部 YAML 依赖）。 */
export function parseRssSourcesYaml(content: string): YamlSourceEntry[] {
  const entries: YamlSourceEntry[] = [];
  let current: Record<string, unknown> | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "sources:") continue;

    if (trimmed.startsWith("- ")) {
      if (current?.name && current?.url) {
        entries.push(current as unknown as YamlSourceEntry);
      }
      current = {};
      const rest = trimmed.slice(2).trim();
      if (rest.includes(":")) {
        const idx = rest.indexOf(":");
        const key = rest.slice(0, idx).trim();
        const val = rest.slice(idx + 1).trim();
        current[key] = parseScalar(val);
      }
      continue;
    }

    if (current && trimmed.includes(":")) {
      const idx = trimmed.indexOf(":");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (key && val) current[key] = parseScalar(val);
    }
  }

  if (current?.name && current?.url) {
    entries.push(current as unknown as YamlSourceEntry);
  }

  return entries;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fallbackSlug(url: string): string {
  const trivial = new Set(["feed", "rss", "atom", "feeds"]);
  try {
    const { hostname, pathname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const slug = toSlug(segments[i].replace(/\.[^.]+$/, ""));
      if (slug && !trivial.has(slug)) return slug;
    }
    const domain = hostname.replace(/^(www|blog|tech|eng|engineering)\./i, "");
    return toSlug(domain.split(".")[0]) || "unknown";
  } catch {
    return "unknown";
  }
}

export function extractRSSField(block: string, tagPattern: RegExp): string {
  const match = block.match(tagPattern);
  if (!match?.[1]) return "";

  let value = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  value = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function loadRSSFeeds(): RSSFeedConfig[] {
  if (!existsSync(RSS_SOURCES_FILE)) {
    console.log("[CollectNode] rss_sources.yaml 不存在，使用内置 RSS 源");
    return BUILTIN_RSS_FEEDS;
  }

  try {
    const raw = readFileSync(RSS_SOURCES_FILE, "utf-8");
    const entries = parseRssSourcesYaml(raw);

    if (entries.length === 0) {
      console.log("[CollectNode] rss_sources.yaml 为空，使用内置 RSS 源");
      return BUILTIN_RSS_FEEDS;
    }

    const feeds: RSSFeedConfig[] = [];
    for (const entry of entries) {
      if (!entry.name || !entry.url) continue;
      if (entry.enabled === false) continue;

      const nameSlug = toSlug(entry.name);
      feeds.push({
        slug: nameSlug || fallbackSlug(entry.url),
        name: entry.name,
        url: entry.url,
        category: entry.category,
        limit:
          typeof entry.limit === "number" && entry.limit > 0
            ? entry.limit
            : undefined,
      });
    }

    console.log(`[CollectNode] 从 rss_sources.yaml 加载 ${feeds.length} 个 RSS 源`);
    return feeds.length > 0 ? feeds : BUILTIN_RSS_FEEDS;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `[CollectNode] rss_sources.yaml 解析失败: ${message}，使用内置 RSS 源`,
    );
    return BUILTIN_RSS_FEEDS;
  }
}

async function parseFeed(
  feed: RSSFeedConfig,
  limit: number,
): Promise<Record<string, unknown>[]> {
  let xml: string;
  try {
    const resp = await fetch(feed.url, {
      headers: { "User-Agent": "AI-Knowledge-Pipeline/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.log(`[CollectNode] RSS ${feed.name} 返回 ${resp.status}，跳过`);
      return [];
    }
    xml = await resp.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[CollectNode] RSS ${feed.name} 请求失败: ${message}`);
    return [];
  }

  const itemBlocks: string[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) itemBlocks.push(match[1]);
  if (itemBlocks.length === 0) {
    while ((match = entryRe.exec(xml)) !== null) itemBlocks.push(match[1]);
  }

  const source = `rss-${feed.slug}`;
  const collectedAt = new Date().toISOString();
  const items: Record<string, unknown>[] = [];

  for (let i = 0; i < Math.min(itemBlocks.length, limit); i++) {
    const block = itemBlocks[i];

    const title = extractRSSField(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const link =
      extractRSSField(block, /<link[^>]*href="([^"]+)"/i) ||
      extractRSSField(block, /<link[^>]*>([\s\S]*?)<\/link>/i);
    const description =
      extractRSSField(block, /<description[^>]*>([\s\S]*?)<\/description>/i) ||
      extractRSSField(block, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      extractRSSField(block, /<content[^>]*>([\s\S]*?)<\/content>/i);
    const author =
      extractRSSField(block, /<author[^>]*>([\s\S]*?)<\/author>/i) ||
      extractRSSField(block, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    const pubDate =
      extractRSSField(block, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      extractRSSField(block, /<published[^>]*>([\s\S]*?)<\/published>/i) ||
      extractRSSField(block, /<updated[^>]*>([\s\S]*?)<\/updated>/i);

    if (!title || !link) continue;

    let publishedAt: string | null = null;
    if (pubDate) {
      const parsed = Date.parse(pubDate);
      if (!Number.isNaN(parsed)) {
        publishedAt = new Date(parsed).toISOString();
      }
    }

    items.push({
      source,
      title,
      source_id: link,
      url: link,
      description: description.slice(0, 1000),
      author: author || feed.name,
      published_at: publishedAt,
      category: feed.category ?? "",
      collected_at: collectedAt,
    });
  }

  return items;
}

/** 从所有已启用的 RSS 源采集文章。 */
export async function collectRss(
  defaultLimit: number,
): Promise<Record<string, unknown>[]> {
  const feeds = loadRSSFeeds();
  const allItems: Record<string, unknown>[] = [];

  for (const feed of feeds) {
    const feedLimit = feed.limit ?? defaultLimit;
    console.log(
      `[CollectNode] 解析 RSS: ${feed.name} (${feed.url}) limit=${feedLimit}`,
    );
    const items = await parseFeed(feed, feedLimit);
    allItems.push(...items);
  }

  console.log(`[CollectNode] RSS 采集完成，共 ${allItems.length} 条`);
  return allItems;
}
