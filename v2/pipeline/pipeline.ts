#!/usr/bin/env tsx

/**
 * AI 知识库自动化流水线。
 *
 * 四步流水线：
 *   Step 1 - 采集（Collect）：从 GitHub Search API 和 RSS 源采集 AI 相关内容
 *   Step 2 - 分析（Analyze）：调用 LLM 对每条内容进行摘要/评分/标签分析
 *   Step 3 - 整理（Organize）：去重 + 格式标准化 + 校验
 *   Step 4 - 保存（Save）：将文章保存为独立 JSON 文件到 knowledge/articles/
 *
 * 用法：
 *
 *   # 完整流水线（GitHub + RSS，采集 20 条）
 *   npx tsx pipeline/pipeline.ts --sources github,rss --limit 20
 *
 *   # 只采集 GitHub，限制 5 条
 *   npx tsx pipeline/pipeline.ts --sources github --limit 5
 *
 *   # 只采集 RSS，限制 10 条
 *   npx tsx pipeline/pipeline.ts --sources rss --limit 10
 *
 *   # 干跑模式（不实际写入文件，用于测试采集和分析流程）
 *   npx tsx pipeline/pipeline.ts --sources github --limit 5 --dry-run
 *
 *   # 完整流水线 + 详细日志（显示每条采集/分析/去重细节）
 *   npx tsx pipeline/pipeline.ts --sources github,rss --limit 20 --verbose
 *
 *   # 干跑 + 详细日志（最安全的调试方式）
 *   npx tsx pipeline/pipeline.ts --sources github,rss --limit 5 --dry-run --verbose
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatWithTry, getProvider, type ChatMessage } from "./model-client.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

/** 项目根目录（pipeline/ 的父目录）。 */
const ROOT_DIR = resolve(__dirname, "..");

const RAW_DIR = join(ROOT_DIR, "knowledge", "raw");
const ARTICLES_DIR = join(ROOT_DIR, "knowledge", "articles");
const INDEX_FILE = join(ARTICLES_DIR, "index.json");

/** RSS 源配置文件路径。 */
const SOURCES_CONFIG_FILE = join(__dirname, "sources.json");

/** 内置兜底 RSS 源，sources.json 缺失时使用。 */
const BUILTIN_RSS_FEEDS: RSSFeedConfig[] = [
  { name: "arxiv-ai",    url: "https://export.arxiv.org/rss/cs.AI",      label: "Arxiv CS.AI" },
];

/** GitHub Search API 查询词（AI 相关话题）。 */
const GITHUB_QUERIES = [
  "topic:llm stars:>50",
  "topic:ai-agent stars:>50",
  "topic:large-language-model stars:>30",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** sources.json 中单条 RSS 源的配置。 */
interface RSSFeedConfig {
  /** Feed 唯一名称，用于 source 字段和文件命名。 */
  name: string;
  /** RSS/Atom 订阅 URL。 */
  url: string;
  /** 可读标签，仅用于日志展示。 */
  label?: string;
}

/** sources.json 的顶层结构。 */
interface SourcesConfig {
  rss?: RSSFeedConfig[];
}

/** 采集阶段的原始条目。 */
interface RawItem {
  /** 唯一标识，由采集器生成。 */
  id: string;
  /** 标题。 */
  title: string;
  /** 来源类型，如 github-search / rss-arxiv-ai。 */
  source: string;
  /** 来源中的原始标识（仓库名 / 文章链接）。 */
  source_id: string;
  /** 原始链接。 */
  source_url: string;
  /** 作者/组织名。 */
  author: string;
  /** 发布时间（ISO 8601），未知时为 null。 */
  published_at: string | null;
  /** 原始描述文本。 */
  raw_description: string;
  /** 采集时间（ISO 8601）。 */
  collected_at: string;
  /** GitHub 专属：Star 数量。 */
  stars?: number;
  /** GitHub 专属：话题标签。 */
  topics?: string[];
}

/** 文章（分析 + 整理后）。 */
interface Article {
  id: string;
  title: string;
  source: string;
  source_id: string;
  source_url: string;
  author: string;
  published_at: string | null;
  raw_description: string;
  summary: string;
  tags: string[];
  category: string;
  score: number;
  audience: string;
  analysis_note: string;
  collected_at: string;
  analyzed_at: string | null;
  organized_at: string | null;
  status: "published" | "review" | "skipped";
}

/** 索引条目（存入 index.json）。 */
interface IndexEntry {
  id: string;
  title: string;
  source: string;
  source_id: string;
  category: string;
  relevance_score: number;
  tags: string[];
  status: string;
  collected_at: string;
}

/** 流水线运行选项。 */
interface PipelineOptions {
  sources: string[];
  limit: number;
  dryRun: boolean;
  verbose: boolean;
}

/** LLM 分析结果结构。 */
interface AnalysisResult {
  summary: string;
  tags: string[];
  category: string;
  score: number;
  audience: string;
  analysis_note: string;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let verboseMode = false;

const log = {
  info(msg: string, ...args: unknown[]): void {
    console.log(`[INFO] ${msg}`, ...args);
  },
  step(step: number, name: string, msg: string): void {
    console.log(`\n[Step ${step}] ${name} — ${msg}`);
  },
  verbose(msg: string, ...args: unknown[]): void {
    if (verboseMode) console.log(`  [DBG] ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    console.error(`[ERR] ${msg}`, ...args);
  },
  dryRun(msg: string): void {
    console.log(`[DRY-RUN] ${msg}`);
  },
};

// ---------------------------------------------------------------------------
// CLI Argument Parser
// ---------------------------------------------------------------------------

/**
 * 解析命令行参数，返回 PipelineOptions。
 *
 * 支持参数：
 *   --sources <github|rss|github,rss>  采集源，逗号分隔
 *   --limit <n>                         每源最大条数
 *   --dry-run                           干跑模式，不写文件
 *   --verbose                           详细日志
 *
 * Returns:
 *   PipelineOptions 对象。
 */
function parseArgs(): PipelineOptions {
  const argv = process.argv.slice(2);
  const opts: PipelineOptions = {
    sources: ["github", "rss"],
    limit: 20,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--sources":
        opts.sources = (argv[++i] ?? "github,rss").split(",").map((s) => s.trim());
        break;
      case "--limit":
        opts.limit = parseInt(argv[++i] ?? "20", 10);
        if (isNaN(opts.limit) || opts.limit <= 0) opts.limit = 20;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      default:
        if (arg.startsWith("--")) {
          log.warn(`未知参数: ${arg}`);
        }
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * 返回当前日期字符串，格式 YYYY-MM-DD。
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 返回当前 ISO 8601 时间戳。
 */
function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 返回当前时间戳字符串，格式 YYYY-MM-DD-HHmmss，用于文件命名。
 */
function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 读取并解析已有 JSON 文件，失败时返回默认值。
 */
function readJSON<T>(filePath: string, defaultVal: T): T {
  if (!existsSync(filePath)) return defaultVal;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return defaultVal;
  }
}

/**
 * 从正则捕获提取 RSS 字段值，去除 CDATA 包装和 HTML 标签。
 *
 * Args:
 *   block: XML 片段文本。
 *   tagPattern: 匹配标签的正则（含捕获组）。
 *
 * Returns:
 *   清理后的字符串，找不到时返回空字符串。
 */
function extractRSSField(block: string, tagPattern: RegExp): string {
  const m = block.match(tagPattern);
  if (!m || !m[1]) return "";
  // 去除 CDATA 包装
  let val = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  // 去除 HTML 标签
  val = val.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // 解码常见 HTML 实体
  val = val
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  return val;
}

/**
 * 生成 slug 格式字符串，用于文件命名（小写、连字符）。
 */
function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 生成文章文件名，格式：{date}-{seq:03d}-{sourceSlug}.json。
 */
function articleFileName(date: string, seq: number, source: string): string {
  const padded = String(seq).padStart(3, "0");
  return `${date}-${padded}-${toSlug(source)}.json`;
}

// ---------------------------------------------------------------------------
// Step 1: Collect
// ---------------------------------------------------------------------------

/**
 * 从 GitHub Search API 采集 AI 相关仓库。
 *
 * 使用三个搜索词轮询，合并去重后按 limit 截断。
 * 未设置 GITHUB_TOKEN 时以匿名请求（60 次/小时限制）。
 *
 * Args:
 *   limit: 最大采集条数。
 *
 * Returns:
 *   RawItem 数组。
 */
async function collectGitHub(limit: number): Promise<RawItem[]> {
  const token = process.env["GITHUB_TOKEN"] ?? "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const seen = new Set<string>();
  const items: RawItem[] = [];
  const dateStr = today();
  const source = "github-search";

  for (const query of GITHUB_QUERIES) {
    if (items.length >= limit) break;

    const perPage = Math.min(limit - items.length, 30);
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
    log.verbose(`GitHub 搜索: ${query}`);

    let data: Record<string, unknown>;
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        log.warn(`GitHub API 返回 ${resp.status}，跳过查询: ${query}`);
        continue;
      }
      data = (await resp.json()) as Record<string, unknown>;
    } catch (err) {
      log.warn(`GitHub 请求失败: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const repos = data["items"] as Array<Record<string, unknown>> | undefined;
    if (!repos || repos.length === 0) continue;

    for (const repo of repos) {
      if (items.length >= limit) break;

      const fullName = (repo["full_name"] as string) ?? "";
      if (!fullName || seen.has(fullName)) continue;
      seen.add(fullName);

      const owner = (repo["owner"] as Record<string, unknown> | undefined)?.["login"] as string ?? "";
      const description = (repo["description"] as string) ?? "";
      const htmlUrl = (repo["html_url"] as string) ?? `https://github.com/${fullName}`;
      const stars = (repo["stargazers_count"] as number) ?? 0;
      const topics = (repo["topics"] as string[]) ?? [];
      const pushedAt = (repo["pushed_at"] as string | null) ?? null;

      const seq = items.length + 1;
      const id = `${source}-${dateStr}-${String(seq).padStart(3, "0")}`;

      items.push({
        id,
        title: fullName,
        source,
        source_id: fullName,
        source_url: htmlUrl,
        author: owner,
        published_at: pushedAt,
        raw_description: description,
        collected_at: nowISO(),
        stars,
        topics,
      });
      log.verbose(`  + GitHub: ${fullName} (★${stars})`);
    }

    // 遵守 GitHub API 速率限制
    await new Promise((r) => setTimeout(r, 300));
  }

  log.info(`GitHub 采集完成，共 ${items.length} 条`);
  return items;
}

/**
 * 解析单个 RSS feed，返回 RawItem 列表。
 *
 * Args:
 *   feedName: Feed 唯一名称（用于 source 字段）。
 *   feedUrl: RSS URL。
 *   limit: 最大条数。
 *   dateStr: 当前日期字符串（用于 ID 生成）。
 *   seqOffset: 序列号起始偏移。
 *
 * Returns:
 *   RawItem 数组。
 */
async function parseFeed(
  feedName: string,
  feedUrl: string,
  limit: number,
  dateStr: string,
  seqOffset: number,
): Promise<RawItem[]> {
  let xml: string;
  try {
    const resp = await fetch(feedUrl, {
      headers: { "User-Agent": "AI-Knowledge-Pipeline/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      log.warn(`RSS ${feedName} 返回 ${resp.status}，跳过`);
      return [];
    }
    xml = await resp.text();
  } catch (err) {
    log.warn(`RSS ${feedName} 请求失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  // 提取所有 <item> 或 <entry> 块
  const itemBlocks: string[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) itemBlocks.push(m[1]);
  if (itemBlocks.length === 0) {
    while ((m = entryRe.exec(xml)) !== null) itemBlocks.push(m[1]);
  }

  const source = `rss-${feedName}`;
  const items: RawItem[] = [];

  for (let i = 0; i < Math.min(itemBlocks.length, limit); i++) {
    const block = itemBlocks[i];

    const title = extractRSSField(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const link =
      extractRSSField(block, /<link[^>]*>([\s\S]*?)<\/link>/i) ||
      extractRSSField(block, /href="([^"]+)"/i);
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
      if (!isNaN(parsed)) {
        publishedAt = new Date(parsed).toISOString();
      }
    }

    // 截断过长的描述
    const rawDesc = description.slice(0, 1000);
    const seq = seqOffset + i + 1;
    const id = `${source}-${dateStr}-${String(seq).padStart(3, "0")}`;

    items.push({
      id,
      title,
      source,
      source_id: link,
      source_url: link,
      author: author || feedName,
      published_at: publishedAt,
      raw_description: rawDesc,
      collected_at: nowISO(),
    });
    log.verbose(`  + RSS [${feedName}]: ${title.slice(0, 60)}`);
  }

  return items;
}

/**
 * 从 sources.json 加载 RSS 源配置，文件缺失或解析失败时回退到内置列表。
 *
 * sources.json 格式：
 *   { "rss": [{ "name": "my-feed", "url": "https://...", "label": "可选标签" }] }
 *
 * Returns:
 *   RSSFeedConfig 数组。
 */
function loadRSSFeeds(): RSSFeedConfig[] {
  if (!existsSync(SOURCES_CONFIG_FILE)) {
    log.verbose(`sources.json 不存在 (${SOURCES_CONFIG_FILE})，使用内置 RSS 源`);
    return BUILTIN_RSS_FEEDS;
  }

  try {
    const raw = readFileSync(SOURCES_CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw) as SourcesConfig;
    const feeds = config.rss;

    if (!Array.isArray(feeds) || feeds.length === 0) {
      log.warn("sources.json 中 rss 字段为空或格式错误，使用内置 RSS 源");
      return BUILTIN_RSS_FEEDS;
    }

    // 过滤掉缺少必填字段的条目
    const valid = feeds.filter((f) => {
      if (!f.name || !f.url) {
        log.warn(`RSS 源配置缺少 name 或 url，已跳过: ${JSON.stringify(f)}`);
        return false;
      }
      return true;
    });

    log.verbose(`从 sources.json 加载了 ${valid.length} 个 RSS 源`);
    return valid.length > 0 ? valid : BUILTIN_RSS_FEEDS;
  } catch (err) {
    log.warn(`sources.json 解析失败: ${err instanceof Error ? err.message : String(err)}，使用内置 RSS 源`);
    return BUILTIN_RSS_FEEDS;
  }
}

/**
 * 从所有配置的 RSS 源采集内容。
 *
 * RSS 源列表优先读取 pipeline/sources.json，找不到时回退到内置列表。
 *
 * Args:
 *   limit: 每源最大条数。
 *
 * Returns:
 *   合并后的 RawItem 数组。
 */
async function collectRSS(limit: number): Promise<RawItem[]> {
  const feeds = loadRSSFeeds();
  const dateStr = today();
  const allItems: RawItem[] = [];

  for (const feed of feeds) {
    const label = feed.label ?? feed.name;
    log.verbose(`解析 RSS: ${label} (${feed.url})`);
    const items = await parseFeed(feed.name, feed.url, limit, dateStr, allItems.length);
    allItems.push(...items);
  }

  log.info(`RSS 采集完成，共 ${allItems.length} 条`);
  return allItems;
}

/**
 * Step 1：采集阶段入口。
 *
 * 根据 options.sources 调用对应采集器，合并原始数据并写入 knowledge/raw/。
 *
 * Args:
 *   options: PipelineOptions。
 *
 * Returns:
 *   采集到的 RawItem 数组。
 */
async function stepCollect(options: PipelineOptions): Promise<RawItem[]> {
  log.step(1, "采集", `sources=[${options.sources.join(",")}] limit=${options.limit}`);

  const allItems: RawItem[] = [];

  for (const src of options.sources) {
    const perSourceLimit = options.limit;
    if (src === "github") {
      const items = await collectGitHub(perSourceLimit);
      allItems.push(...items);
    } else if (src === "rss") {
      const items = await collectRSS(perSourceLimit);
      allItems.push(...items);
    } else {
      log.warn(`未知来源: ${src}，已跳过`);
    }
  }

  if (allItems.length === 0) {
    log.warn("采集结果为空");
    return [];
  }

  // 保存原始数据到 knowledge/raw/
  const rawFile = join(RAW_DIR, `pipeline-${nowTimestamp()}.json`);
  if (!options.dryRun) {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(rawFile, JSON.stringify(allItems, null, 2), "utf-8");
    log.info(`原始数据已写入: ${rawFile}`);
  } else {
    log.dryRun(`将写入原始数据: ${rawFile} (${allItems.length} 条)`);
  }

  log.info(`采集完成，共 ${allItems.length} 条`);
  return allItems;
}

// ---------------------------------------------------------------------------
// Step 2: Analyze
// ---------------------------------------------------------------------------

/** LLM 分析 Prompt 模板。 */
const ANALYZE_SYSTEM = `你是一个 AI 技术内容分析师，专注于 AI/LLM/Agent 领域。
对给定内容进行评估，输出严格的 JSON 格式，不得包含任何多余文字。`;

/**
 * 构建分析请求的用户提示词。
 */
function buildAnalyzePrompt(item: RawItem): string {
  const starsInfo = item.stars !== undefined ? `\nGitHub Stars: ${item.stars}` : "";
  const topicsInfo =
    item.topics && item.topics.length > 0
      ? `\nTopics: ${item.topics.join(", ")}`
      : "";

  return `请分析以下内容并以 JSON 格式返回分析结果：

标题: ${item.title}
来源: ${item.source}
链接: ${item.source_url}${starsInfo}${topicsInfo}
描述: ${item.raw_description || "(无描述)"}

请输出如下 JSON 格式（不含注释，不含多余文字）：
{
  "summary": "100字以内的中文摘要，简洁说明该项目/文章的核心价值",
  "tags": ["标签1", "标签2", "标签3"],
  "category": "framework | tool | research | paper | dataset | other",
  "score": 0.0到1.0之间的小数（AI/LLM领域相关性和质量评分，0.6以上才值得收录）,
  "audience": "工程师 | 研究员 | 通用",
  "analysis_note": "50字以内，说明打分理由和核心亮点或不足"
}

评分标准：
- 0.8-1.0：顶级 AI 基础设施、重要模型、关键技术突破
- 0.6-0.8：有价值的 LLM 应用、工具、框架
- 0.4-0.6：边缘相关、商业化应用、技术深度一般
- 0.4以下：几乎无关或质量过低`;
}

/**
 * 调用 LLM 分析单条原始数据，返回结构化分析结果。
 *
 * 若 LLM 返回无效 JSON，则使用默认值兜底。
 *
 * Args:
 *   item: 待分析的 RawItem。
 *
 * Returns:
 *   AnalysisResult。
 */
async function analyzeItem(item: RawItem): Promise<AnalysisResult> {
  const fallback: AnalysisResult = {
    summary: item.raw_description.slice(0, 100) || item.title,
    tags: item.topics?.slice(0, 5) ?? [],
    category: "other",
    score: 0.5,
    audience: "通用",
    analysis_note: "LLM 分析失败，使用默认值",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: ANALYZE_SYSTEM },
    { role: "user", content: buildAnalyzePrompt(item) },
  ];

  let content: string;
  try {
    const response = await chatWithTry(messages, {
      temperature: 0.1,
      max_tokens: 400,
    });
    content = response.content.trim();
  } catch (err) {
    log.warn(`LLM 调用失败 [${item.id}]: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }

  // 提取 JSON 块（防止 LLM 在 JSON 前后加说明文字）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn(`LLM 返回非 JSON 格式 [${item.id}]: ${content.slice(0, 80)}`);
    return fallback;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<AnalysisResult>;
    return {
      summary: (typeof parsed.summary === "string" && parsed.summary) ? parsed.summary : fallback.summary,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : fallback.tags,
      category: (typeof parsed.category === "string" && parsed.category) ? parsed.category : fallback.category,
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : fallback.score,
      audience: (typeof parsed.audience === "string" && parsed.audience) ? parsed.audience : fallback.audience,
      analysis_note: (typeof parsed.analysis_note === "string" && parsed.analysis_note) ? parsed.analysis_note : fallback.analysis_note,
    };
  } catch {
    log.warn(`JSON 解析失败 [${item.id}]`);
    return fallback;
  }
}

/**
 * Step 2：分析阶段入口。
 *
 * 逐条调用 LLM，将 RawItem 转换为 Article（含摘要/评分/标签）。
 *
 * Args:
 *   items: 采集结果。
 *   options: PipelineOptions。
 *
 * Returns:
 *   Article 数组（含分析结果，status 暂为 "review"）。
 */
async function stepAnalyze(items: RawItem[], options: PipelineOptions): Promise<Article[]> {
  log.step(2, "分析", `共 ${items.length} 条，调用 LLM 分析中...`);

  if (options.dryRun) {
    log.dryRun("dry-run 模式：跳过 LLM 调用，使用占位分析结果");
    return items.map((item) => ({
      ...item,
      summary: `[DRY-RUN] ${item.raw_description.slice(0, 80)}`,
      tags: item.topics?.slice(0, 3) ?? ["dry-run"],
      category: "other",
      score: 0.5,
      audience: "通用",
      analysis_note: "dry-run 模式",
      analyzed_at: nowISO(),
      organized_at: null,
      status: "review" as const,
    }));
  }

  // 验证 LLM 可用性
  try {
    getProvider();
  } catch (err) {
    log.error(`LLM 提供商初始化失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const articles: Article[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    log.verbose(`分析 [${i + 1}/${items.length}]: ${item.title.slice(0, 50)}`);

    const analysis = await analyzeItem(item);

    articles.push({
      ...item,
      summary: analysis.summary,
      tags: analysis.tags,
      category: analysis.category,
      score: analysis.score,
      audience: analysis.audience,
      analysis_note: analysis.analysis_note,
      analyzed_at: nowISO(),
      organized_at: null,
      status: "review",
    });

    log.verbose(`  score=${analysis.score.toFixed(2)} category=${analysis.category} tags=[${analysis.tags.slice(0, 3).join(",")}]`);

    // 避免 API 频率限制
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  log.info(`分析完成，共 ${articles.length} 条`);
  return articles;
}

// ---------------------------------------------------------------------------
// Step 3: Organize
// ---------------------------------------------------------------------------

/** 文章最低收录分数线。 */
const MIN_SCORE = 0.5;

/**
 * 读取已有文章的 source_id 集合，用于去重。
 *
 * Returns:
 *   Set<string>，包含所有已保存文章的 source_id。
 */
function loadExistingSourceIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(ARTICLES_DIR)) return ids;

  const files = readdirSync(ARTICLES_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );

  for (const file of files) {
    try {
      const article = JSON.parse(
        readFileSync(join(ARTICLES_DIR, file), "utf-8"),
      ) as Partial<Article>;
      if (article.source_id) ids.add(article.source_id);
    } catch {
      // 单文件读取失败不影响整体
    }
  }

  return ids;
}

/**
 * 标准化标签：转小写、去重、限制数量。
 */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
    .filter((t) => {
      if (!t || t.length < 2 || seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .slice(0, 10);
}

/**
 * 校验文章必填字段是否合法。
 *
 * Returns:
 *   true 表示合法，false 表示不通过。
 */
function validateArticle(article: Article): boolean {
  if (!article.id || !article.title || !article.source_url) return false;
  if (!article.summary || article.summary.length < 5) return false;
  if (typeof article.score !== "number" || isNaN(article.score)) return false;
  return true;
}

/**
 * Step 3：整理阶段入口。
 *
 * 对分析结果执行：
 *   1. 低分过滤（score < MIN_SCORE）
 *   2. 跨已有文章去重（基于 source_id）
 *   3. 会话内去重（同次采集的重复条目）
 *   4. 字段标准化（tags、category）
 *   5. 必填字段校验
 *
 * Args:
 *   articles: 分析后的文章列表。
 *   options: PipelineOptions。
 *
 * Returns:
 *   通过整理的 Article 数组（status="published"）。
 */
function stepOrganize(articles: Article[], options: PipelineOptions): Article[] {
  log.step(3, "整理", `共 ${articles.length} 条，开始去重/标准化/校验`);

  const existingIds = loadExistingSourceIds();
  const sessionIds = new Set<string>();
  const organized: Article[] = [];
  const skipped = { lowScore: 0, duplicate: 0, invalid: 0 };

  const organizedAt = nowISO();

  for (const article of articles) {
    // 低分过滤
    if (article.score < MIN_SCORE) {
      log.verbose(`  跳过低分 [${article.id}] score=${article.score.toFixed(2)}`);
      skipped.lowScore++;
      continue;
    }

    // 去重（已有文章）
    if (existingIds.has(article.source_id)) {
      log.verbose(`  跳过重复（已存在）[${article.source_id}]`);
      skipped.duplicate++;
      continue;
    }

    // 去重（本次采集内）
    if (sessionIds.has(article.source_id)) {
      log.verbose(`  跳过重复（本次采集）[${article.source_id}]`);
      skipped.duplicate++;
      continue;
    }
    sessionIds.add(article.source_id);

    // 字段标准化
    const normalizedArticle: Article = {
      ...article,
      title: article.title.slice(0, 200),
      summary: article.summary.slice(0, 500),
      tags: normalizeTags(article.tags),
      category: ["framework", "tool", "research", "paper", "dataset", "other"].includes(
        article.category,
      )
        ? article.category
        : "other",
      analysis_note: article.analysis_note.slice(0, 300),
      organized_at: organizedAt,
      status: "published",
    };

    // 校验
    if (!validateArticle(normalizedArticle)) {
      log.verbose(`  校验失败 [${article.id}]`);
      skipped.invalid++;
      continue;
    }

    organized.push(normalizedArticle);
    existingIds.add(article.source_id); // 防止同次采集的后续重复
  }

  log.info(
    `整理完成：通过 ${organized.length} 条，跳过 ${skipped.lowScore} 低分 / ${skipped.duplicate} 重复 / ${skipped.invalid} 无效`,
  );

  return organized;
}

// ---------------------------------------------------------------------------
// Step 4: Save
// ---------------------------------------------------------------------------

/**
 * 更新 knowledge/articles/index.json。
 *
 * 将新增文章的索引条目追加到现有索引中，按收录时间降序排列。
 *
 * Args:
 *   newArticles: 新增的文章列表。
 */
function updateIndex(newArticles: Article[]): void {
  const existingIndex = readJSON<IndexEntry[]>(INDEX_FILE, []);

  const existingIds = new Set(existingIndex.map((e) => e.id));

  const newEntries: IndexEntry[] = newArticles
    .filter((a) => !existingIds.has(a.id))
    .map((a) => ({
      id: a.id,
      title: a.title,
      source: a.source,
      source_id: a.source_id,
      category: a.category,
      relevance_score: a.score,
      tags: a.tags,
      status: a.status,
      collected_at: a.collected_at,
    }));

  const merged = [...newEntries, ...existingIndex].sort((a, b) =>
    b.collected_at.localeCompare(a.collected_at),
  );

  writeFileSync(INDEX_FILE, JSON.stringify(merged, null, 2), "utf-8");
  log.info(`索引已更新：总计 ${merged.length} 条`);
}

/**
 * Step 4：保存阶段入口。
 *
 * 将每篇文章保存为独立 JSON 文件（knowledge/articles/{date}-{seq}-{source}.json），
 * 并更新 knowledge/articles/index.json。
 *
 * Args:
 *   articles: 经过整理的文章列表。
 *   options: PipelineOptions。
 */
async function stepSave(articles: Article[], options: PipelineOptions): Promise<void> {
  log.step(4, "保存", `共 ${articles.length} 条，写入 knowledge/articles/`);

  if (articles.length === 0) {
    log.info("无新增文章，跳过保存");
    return;
  }

  if (options.dryRun) {
    for (const article of articles) {
      const fname = articleFileName(today(), articles.indexOf(article) + 1, article.source);
      log.dryRun(`将写入: knowledge/articles/${fname} — ${article.title.slice(0, 50)}`);
    }
    log.dryRun(`将更新: knowledge/articles/index.json`);
    return;
  }

  mkdirSync(ARTICLES_DIR, { recursive: true });

  // 确定序列号起始点（基于已有文件数）
  const existingFiles = existsSync(ARTICLES_DIR)
    ? readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".json") && f !== "index.json")
    : [];
  let seq = existingFiles.length + 1;

  const dateStr = today();
  const saved: Article[] = [];

  for (const article of articles) {
    const fname = articleFileName(dateStr, seq, article.source);
    const filePath = join(ARTICLES_DIR, fname);

    // 若文件名冲突则顺序递增
    let finalPath = filePath;
    let finalSeq = seq;
    while (existsSync(finalPath)) {
      finalSeq++;
      finalPath = join(ARTICLES_DIR, articleFileName(dateStr, finalSeq, article.source));
    }

    writeFileSync(finalPath, JSON.stringify(article, null, 2), "utf-8");
    log.verbose(`  保存: ${finalPath.replace(ROOT_DIR + "/", "")}`);
    saved.push(article);
    seq = finalSeq + 1;
  }

  updateIndex(saved);
  log.info(`保存完成，新增 ${saved.length} 篇文章`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * 流水线主入口。
 *
 * 依次执行四个步骤，并打印汇总统计。
 */
async function main(): Promise<void> {
  const options = parseArgs();
  verboseMode = options.verbose;

  console.log("=".repeat(60));
  console.log("AI 知识库自动化流水线");
  console.log("=".repeat(60));
  log.info(`sources: [${options.sources.join(", ")}]`);
  log.info(`limit:   ${options.limit}`);
  log.info(`dry-run: ${options.dryRun}`);
  log.info(`verbose: ${options.verbose}`);
  console.log("=".repeat(60));

  const startAt = Date.now();

  // Step 1: Collect
  const rawItems = await stepCollect(options);
  if (rawItems.length === 0) {
    log.warn("采集结果为空，流水线终止");
    process.exit(0);
  }

  // Step 2: Analyze
  const analyzed = await stepAnalyze(rawItems, options);

  // Step 3: Organize
  const organized = stepOrganize(analyzed, options);

  // Step 4: Save
  await stepSave(organized, options);

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("流水线完成");
  console.log("=".repeat(60));
  log.info(`采集: ${rawItems.length} 条`);
  log.info(`分析: ${analyzed.length} 条`);
  log.info(`整理: ${organized.length} 条（通过）`);
  log.info(`耗时: ${elapsed}s`);
  console.log("=".repeat(60));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error(`未捕获异常: ${err instanceof Error ? err.message : String(err)}`);
    if (verboseMode && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
