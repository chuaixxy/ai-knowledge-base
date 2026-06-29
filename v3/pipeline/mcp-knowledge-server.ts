#!/usr/bin/env tsx

/**
 * MCP Knowledge Server
 *
 * 通过 JSON-RPC 2.0 over stdio 为 AI 工具提供本地知识库搜索能力。
 *
 * 工具列表：
 *   search_articles(keyword, limit?)  按关键词搜索文章标题、摘要、标签
 *   get_article(article_id)           按 id 获取文章完整内容
 *   knowledge_stats()                 返回统计信息（总数、来源分布、热门标签）
 *
 * 用法：
 *   npx tsx pipeline/mcp-knowledge-server.ts
 *
 * Claude Desktop 配置（claude_desktop_config.json）：
 *   {
 *     "mcpServers": {
 *       "knowledge": {
 *         "command": "npx",
 *         "args": ["tsx", "/absolute/path/to/pipeline/mcp-knowledge-server.ts"]
 *       }
 *     }
 *   }
 */

import { createInterface } from "node:readline";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ARTICLES_DIR = resolve(__dirname, "..", "knowledge", "articles");
const SERVER_NAME = "mcp-knowledge-server";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Article {
  id: string;
  title: string;
  source: string;
  source_id?: string;
  source_url?: string;
  author?: string;
  published_at?: string | null;
  raw_description?: string;
  summary: string;
  tags: string[];
  category: string;
  score: number;
  audience?: string;
  analysis_note?: string;
  collected_at?: string;
  analyzed_at?: string | null;
  organized_at?: string | null;
  status?: string;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Article Store（进程内缓存，只读一次磁盘）
// ---------------------------------------------------------------------------

let _cache: Article[] | null = null;

/**
 * 读取 knowledge/articles/ 下所有 JSON 文章（跳过 index.json）。
 * 按 score 降序排列并缓存，后续调用直接返回缓存。
 */
function loadArticles(): Article[] {
  if (_cache !== null) return _cache;

  if (!existsSync(ARTICLES_DIR)) {
    _cache = [];
    return _cache;
  }

  const files = readdirSync(ARTICLES_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );

  const articles: Article[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(ARTICLES_DIR, file), "utf-8");
      const a = JSON.parse(raw) as Article;
      if (a.id && a.title) articles.push(a);
    } catch {
      // 忽略解析失败的文件
    }
  }

  _cache = articles.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return _cache;
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

/**
 * 按关键词搜索文章，匹配 title / summary / tags / analysis_note。
 */
function toolSearchArticles(keyword: string, limit: number): object {
  const kw = keyword.toLowerCase();
  const matched = loadArticles()
    .filter(
      (a) =>
        a.title.toLowerCase().includes(kw) ||
        (a.summary ?? "").toLowerCase().includes(kw) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(kw)) ||
        (a.analysis_note ?? "").toLowerCase().includes(kw),
    )
    .slice(0, limit);

  return {
    total: matched.length,
    keyword,
    articles: matched.map((a) => ({
      id: a.id,
      title: a.title,
      source: a.source,
      category: a.category,
      score: a.score,
      tags: a.tags,
      summary: a.summary,
      source_url: a.source_url ?? null,
    })),
  };
}

/**
 * 按 id 返回文章完整内容。
 */
function toolGetArticle(articleId: string): object {
  const article = loadArticles().find((a) => a.id === articleId);
  if (!article) return { error: `未找到文章：${articleId}` };
  return article;
}

/**
 * 返回知识库统计：总数、来源分布、分类分布、热门标签 Top 10、平均评分。
 */
function toolKnowledgeStats(): object {
  const articles = loadArticles();

  const count = (arr: string[]) =>
    arr.reduce<Record<string, number>>((acc, k) => {
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

  const toRanked = (rec: Record<string, number>) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, count: n }));

  const tagCount: Record<string, number> = {};
  for (const a of articles) {
    for (const tag of a.tags ?? []) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1;
    }
  }

  const avgScore =
    articles.length > 0
      ? articles.reduce((s, a) => s + (a.score ?? 0), 0) / articles.length
      : 0;

  return {
    total_articles: articles.length,
    avg_score: parseFloat(avgScore.toFixed(3)),
    sources: toRanked(count(articles.map((a) => a.source))),
    categories: toRanked(count(articles.map((a) => a.category ?? "other"))),
    top_tags: toRanked(tagCount).slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// MCP Tool Definitions
// ---------------------------------------------------------------------------

const TOOLS: MCPTool[] = [
  {
    name: "search_articles",
    description:
      "按关键词搜索本地知识库文章，匹配标题、摘要、标签（大小写不敏感）",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        limit: {
          type: "number",
          description: "返回最大条数，默认 5，最大 20",
          default: 5,
        },
      },
      required: ["keyword"],
    },
  },
  {
    name: "get_article",
    description: "按文章 id 获取完整内容（含摘要、标签、原始描述等所有字段）",
    inputSchema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description: "文章 id，如 github-search-2026-06-25-020",
        },
      },
      required: ["article_id"],
    },
  },
  {
    name: "knowledge_stats",
    description:
      "返回知识库统计信息：文章总数、平均评分、来源分布、分类分布、热门标签 Top 10",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC Helpers
// ---------------------------------------------------------------------------

type ReqId = number | string | null;

function ok(id: ReqId, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: ReqId, code: number, message: string): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Request Dispatcher
// ---------------------------------------------------------------------------

/**
 * 处理单条 JSON-RPC 请求，返回响应；Notification（无 id）返回 null。
 */
function dispatch(req: JSONRPCRequest): JSONRPCResponse | null {
  const id: ReqId = req.id ?? null;

  // Notification — 不响应
  if (req.id === undefined) return null;

  switch (req.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const params = req.params ?? {};
      const name = params["name"] as string | undefined;
      const args = (params["arguments"] ?? {}) as Record<string, unknown>;

      if (!name) return err(id, -32602, "缺少 name 参数");

      try {
        let result: object;

        switch (name) {
          case "search_articles": {
            const keyword = args["keyword"] as string | undefined;
            if (!keyword) return err(id, -32602, "search_articles 需要 keyword");
            const limit = Math.min(
              typeof args["limit"] === "number" ? args["limit"] : 5,
              20,
            );
            result = toolSearchArticles(keyword, limit);
            break;
          }

          case "get_article": {
            const articleId = args["article_id"] as string | undefined;
            if (!articleId) return err(id, -32602, "get_article 需要 article_id");
            result = toolGetArticle(articleId);
            break;
          }

          case "knowledge_stats":
            result = toolKnowledgeStats();
            break;

          default:
            return err(id, -32601, `未知工具：${name}`);
        }

        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        return err(id, -32603, `工具执行失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    default:
      return err(id, -32601, `未知方法：${req.method}`);
  }
}

// ---------------------------------------------------------------------------
// Main — stdio 消息循环
// ---------------------------------------------------------------------------

function main(): void {
  // 预热：进程启动时加载文章，首次请求无延迟
  const articles = loadArticles();
  process.stderr.write(
    `[${SERVER_NAME}] 已加载 ${articles.length} 篇文章，监听 stdio...\n`,
  );

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JSONRPCRequest;
    try {
      req = JSON.parse(trimmed) as JSONRPCRequest;
    } catch {
      process.stdout.write(
        JSON.stringify(err(null, -32700, "Parse error")) + "\n",
      );
      return;
    }

    const response = dispatch(req);
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  });

  rl.on("close", () => process.exit(0));
}

main();
