#!/usr/bin/env tsx

/**
 * Router 路由模式示例。
 *
 * 两层意图分类策略：
 *   第一层：关键词快速匹配（零成本，不调 LLM）
 *   第二层：LLM 分类兜底（处理模糊意图）
 *
 * 三种意图：
 *   - github_search   → 调用 GitHub Search API
 *   - knowledge_query → 从本地 knowledge/articles/index.json 检索
 *   - general_chat    → 调用 LLM 直接回答
 *
 * 用法：
 *   tsx patterns/router.ts "react 状态管理库"
 *   tsx patterns/router.ts "知识库里有什么 AI 文章"
 *   tsx patterns/router.ts "什么是 Transformer"
 */

import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { chat } from "../pipeline/model-client.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Intent = "github_search" | "knowledge_query" | "general_chat";

interface ArticleEntry {
  id: string;
  title: string;
  source: string;
  source_id?: string;
  category: string;
  relevance_score: number;
  tags?: string[];
  status: string;
  collected_at: string;
}

interface GitHubRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  html_url: string;
  language: string | null;
}

interface GitHubSearchResult {
  total_count: number;
  items: GitHubRepo[];
}

// ---------------------------------------------------------------------------
// Layer 1: Keyword fast-path (zero LLM cost)
// ---------------------------------------------------------------------------

const GITHUB_KEYWORDS = [
  "github", "repo", "仓库", "开源", "star", "fork",
  "trending", "代码库", "项目地址", "找项目", "搜项目",
];

const KNOWLEDGE_KEYWORDS = [
  "知识库", "知识库文章", "已收录", "收集的文章", "本地文章",
  "检索文章", "搜索文章", "查找文章", "index.json",
];

/**
 * 关键词快速匹配，命中则立即返回意图，否则返回 null 触发 LLM 分类。
 */
function keywordMatch(query: string): Intent | null {
  const lower = query.toLowerCase();
  if (GITHUB_KEYWORDS.some((kw) => lower.includes(kw))) return "github_search";
  if (KNOWLEDGE_KEYWORDS.some((kw) => lower.includes(kw))) return "knowledge_query";
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: LLM classification fallback
// ---------------------------------------------------------------------------

/**
 * 调用 LLM 对模糊意图进行分类，返回三种意图之一。
 * 若 LLM 返回无法识别的值，默认降级为 general_chat。
 */
async function llmClassify(query: string): Promise<Intent> {
  const system = `你是一个意图分类器。请将用户的查询分类为以下三种意图之一：

- github_search：用户想在 GitHub 上搜索仓库、项目或代码
- knowledge_query：用户想检索本地已收录的文章或知识库内容
- general_chat：其他类型的问题，直接对话回答

规则：
1. 只输出意图名称，不要任何解释或标点
2. 必须从上述三个选项中选一个`;

  const { content } = await chat(query, system);
  const intent = content.trim() as Intent;

  const valid: Intent[] = ["github_search", "knowledge_query", "general_chat"];
  if (valid.includes(intent)) return intent;

  // 宽松匹配：LLM 可能输出带空格或换行
  for (const v of valid) {
    if (content.includes(v)) return v;
  }

  return "general_chat";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * github_search 处理器：调用 GitHub Search API，返回格式化的仓库列表。
 *
 * query 参数经 encodeURIComponent 编码，正确处理中文与空格。
 */
async function handleGithubSearch(query: string): Promise<string> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.github.com/search/repositories?q=${encoded}&sort=stars&order=desc&per_page=5`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ai-knowledge-base-router/1.0",
  };
  if (process.env["GITHUB_TOKEN"]) {
    headers["Authorization"] = `Bearer ${process.env["GITHUB_TOKEN"]}`;
  }

  let resp: Response;
  try {
    resp = await fetch(url, { headers });
  } catch (err) {
    return `GitHub API 网络请求失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return `GitHub API 请求失败: HTTP ${resp.status}${body ? ` — ${body.slice(0, 200)}` : ""}`;
  }

  const data = (await resp.json()) as GitHubSearchResult;

  if (!data.items || data.items.length === 0) {
    return `GitHub 上未找到与 "${query}" 相关的仓库。`;
  }

  const lines: string[] = [
    `GitHub 搜索结果（共 ${data.total_count.toLocaleString()} 个，显示前 ${data.items.length} 个）：`,
    "",
  ];

  for (const repo of data.items) {
    lines.push(`★ ${repo.full_name}  ⭐ ${repo.stargazers_count.toLocaleString()}  语言: ${repo.language ?? "N/A"}`);
    if (repo.description) lines.push(`  ${repo.description}`);
    lines.push(`  ${repo.html_url}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * knowledge_query 处理器：在本地 knowledge/articles/index.json 中检索文章。
 *
 * 查找顺序：v3/knowledge → v2/knowledge（兼容两个版本目录）
 * 匹配逻辑：按关键词命中数 + relevance_score 排序，返回前 5 条。
 */
function handleKnowledgeQuery(query: string): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // 候选路径：优先 v3，回退 v2
  const candidates = [
    resolve(__dirname, "..", "knowledge", "articles", "index.json"),
    resolve(__dirname, "..", "..", "v2", "knowledge", "articles", "index.json"),
  ];

  let indexPath: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      indexPath = p;
      break;
    }
  }

  if (!indexPath) {
    return "知识库索引文件不存在（knowledge/articles/index.json），请先运行采集 Pipeline。";
  }

  let articles: ArticleEntry[];
  try {
    articles = JSON.parse(readFileSync(indexPath, "utf-8")) as ArticleEntry[];
  } catch (err) {
    return `知识库索引文件解析失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  // 分词：将查询拆为关键词列表
  const keywords = query
    .toLowerCase()
    .split(/[\s，。、,.\-_]+/)
    .filter((w) => w.length >= 2);

  if (keywords.length === 0) {
    return `请输入有效的查询关键词（至少 2 个字符）。`;
  }

  const scored = articles
    .filter((a) => a.status === "published")
    .map((a) => {
      const text = [a.title, ...(a.tags ?? []), a.category, a.source]
        .join(" ")
        .toLowerCase();
      const hits = keywords.filter((kw) => text.includes(kw)).length;
      return { article: a, hits };
    })
    .filter(({ hits }) => hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.article.relevance_score - a.article.relevance_score,
    )
    .slice(0, 5);

  if (scored.length === 0) {
    return `知识库（${articles.length} 篇）中未找到与 "${query}" 相关的文章。\n关键词: ${keywords.join(", ")}`;
  }

  const lines: string[] = [
    `知识库检索结果（${articles.length} 篇中匹配 ${scored.length} 篇）：`,
    "",
  ];

  for (const { article, hits } of scored) {
    lines.push(`📄 ${article.title}`);
    lines.push(`   来源: ${article.source}  分类: ${article.category}  相关度: ${article.relevance_score}  命中: ${hits}`);
    if (article.tags?.length) lines.push(`   标签: ${article.tags.join(", ")}`);
    lines.push(`   收录: ${article.collected_at}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * general_chat 处理器：直接调用 LLM 回答。
 */
async function handleGeneralChat(query: string): Promise<string> {
  const { content } = await chat(query, "你是一个智能助手，用中文简洁准确地回答用户问题。");
  return content;
}

// ---------------------------------------------------------------------------
// Unified router entry
// ---------------------------------------------------------------------------

/**
 * 统一路由入口。
 *
 * 两层意图分类：
 *   1. 关键词快速匹配（无 LLM 调用）
 *   2. LLM 分类兜底
 *
 * @param query 用户输入的查询字符串
 * @returns 处理结果文本
 */
export async function route(query: string): Promise<string> {
  if (!query.trim()) {
    return "请输入查询内容。";
  }

  // Layer 1: keyword fast-path (zero cost)
  let intent = keywordMatch(query);
  const source = intent ? "keyword" : "llm";

  // Layer 2: LLM fallback for ambiguous intent
  if (!intent) {
    intent = await llmClassify(query);
  }

  console.error(`[Router] query="${query}"  intent=${intent}  source=${source}`);

  switch (intent) {
    case "github_search":
      return handleGithubSearch(query);
    case "knowledge_query":
      return handleKnowledgeQuery(query);
    case "general_chat":
      return handleGeneralChat(query);
  }
}

// ---------------------------------------------------------------------------
// CLI test entry
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    console.error('用法: tsx patterns/router.ts "查询内容"');
    console.error("");
    console.error("示例:");
    console.error('  tsx patterns/router.ts "react 状态管理库"        # → github_search');
    console.error('  tsx patterns/router.ts "知识库里有什么 AI 文章"   # → knowledge_query');
    console.error('  tsx patterns/router.ts "什么是 Transformer"       # → general_chat');
    process.exit(1);
  }

  route(query)
    .then((result) => {
      console.log(result);
    })
    .catch((err) => {
      console.error("路由执行失败:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
