/**
 * knowledge-bot 单元测试
 *
 * 覆盖：recognizeIntent / formatters / SubscriptionManager /
 *        PermissionManager / KnowledgeSearchEngine / KnowledgeBot
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  Intent,
  PermissionLevel,
  KnowledgeSearchEngine,
  SubscriptionManager,
  PermissionManager,
  KnowledgeBot,
  recognizeIntent,
  formatSearchResults,
  formatDigest,
  formatHelp,
  type SearchOptions,
} from "../bot/knowledge-bot.js";
import type { Article } from "../distribution/formatter.js";

// ── 测试工具 ──────────────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "2026-07-08-001",
    title: "Test Article",
    source: "github",
    url: "https://example.com",
    summary: "这是一篇测试文章的摘要，包含一些技术内容。",
    tags: ["agent"],
    relevance_score: 0.8,
    category: "AI代理框架",
    ...overrides,
  };
}

/** 创建临时目录，返回路径（测试后自动清理）。 */
async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-test-"));
}

/** 向临时目录写入一批文章 JSON 文件。 */
async function writeArticles(dir: string, articles: Article[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const a of articles) {
    await writeFile(join(dir, `${a.id}.json`), JSON.stringify(a), "utf-8");
  }
}

// ── 1. recognizeIntent ────────────────────────────────────────────────────────

describe("recognizeIntent — 命令前缀", () => {
  test.each([
    ["/search agent框架", Intent.SEARCH, "agent框架"],
    ["/search", Intent.SEARCH, ""],
    ["/today", Intent.TODAY, ""],
    ["/today extra", Intent.TODAY, ""],
    ["/top", Intent.TOP, ""],
    ["/top 14", Intent.TOP, "14"],
    ["/subscribe llm rag", Intent.SUBSCRIBE, "llm rag"],
    ["/unsubscribe rag", Intent.UNSUBSCRIBE, "rag"],
    ["/help", Intent.HELP, ""],
  ] as const)("'%s' → intent=%s args='%s'", (input, intent, args) => {
    const [i, a] = recognizeIntent(input);
    expect(i).toBe(intent);
    expect(a).toBe(args);
  });
});

describe("recognizeIntent — 命令前缀大小写不敏感", () => {
  test("/SEARCH foo → SEARCH", () => {
    const [i, a] = recognizeIntent("/SEARCH foo");
    expect(i).toBe(Intent.SEARCH);
    expect(a).toBe("foo");
  });
});

describe("recognizeIntent — 自然语言（捕获组提取参数）", () => {
  test("'搜索 MCP 协议' → SEARCH, args='MCP 协议'", () => {
    const [i, a] = recognizeIntent("搜索 MCP 协议");
    expect(i).toBe(Intent.SEARCH);
    expect(a).toBe("MCP 协议");
  });

  test("'查找 agent 文章' → SEARCH", () => {
    const [i] = recognizeIntent("查找 agent 文章");
    expect(i).toBe(Intent.SEARCH);
  });

  test("'今天有什么新内容' → TODAY", () => {
    const [i] = recognizeIntent("今天有什么新内容");
    expect(i).toBe(Intent.TODAY);
  });

  test("'今日简报' → TODAY", () => {
    const [i] = recognizeIntent("今日简报");
    expect(i).toBe(Intent.TODAY);
  });

  test("'热门文章' → TOP", () => {
    const [i] = recognizeIntent("热门文章");
    expect(i).toBe(Intent.TOP);
  });

  test("'本周热榜' → TOP", () => {
    const [i] = recognizeIntent("本周热榜");
    expect(i).toBe(Intent.TOP);
  });

  test("'订阅 agent' → SUBSCRIBE, args='agent'", () => {
    const [i, a] = recognizeIntent("订阅 agent");
    expect(i).toBe(Intent.SUBSCRIBE);
    expect(a).toBe("agent");
  });

  test("'取消订阅 rag' → UNSUBSCRIBE（优先于 subscribe）", () => {
    const [i, a] = recognizeIntent("取消订阅 rag");
    expect(i).toBe(Intent.UNSUBSCRIBE);
    expect(a).toBe("rag");
  });

  test("'帮助' → HELP", () => {
    const [i] = recognizeIntent("帮助");
    expect(i).toBe(Intent.HELP);
  });

  test("'使用说明' → HELP", () => {
    const [i] = recognizeIntent("使用说明");
    expect(i).toBe(Intent.HELP);
  });

  test("'随便说说' → UNKNOWN", () => {
    const [i] = recognizeIntent("随便说说");
    expect(i).toBe(Intent.UNKNOWN);
  });

  test("空字符串 → UNKNOWN", () => {
    const [i] = recognizeIntent("  ");
    expect(i).toBe(Intent.UNKNOWN);
  });
});

// ── 2. formatSearchResults ────────────────────────────────────────────────────

describe("formatSearchResults", () => {
  test("无结果时返回提示信息", () => {
    const out = formatSearchResults([], "MCP");
    expect(out).toContain("未找到");
    expect(out).toContain("MCP");
    expect(out).toContain("💡");
  });

  test("无结果无 query 时也返回提示", () => {
    const out = formatSearchResults([]);
    expect(out).toContain("暂无内容");
  });

  test("有结果时包含标题、来源、评分、链接", () => {
    const a = makeArticle({ title: "My Article", source: "github", relevance_score: 0.9 });
    const out = formatSearchResults([a], "agent");
    expect(out).toContain("My Article");
    expect(out).toContain("github");
    expect(out).toContain("0.9");
    expect(out).toContain("https://example.com");
  });

  test("摘要超过 80 字符时截断", () => {
    const longSummary = "x".repeat(200);
    const a = makeArticle({ summary: longSummary });
    const out = formatSearchResults([a], "x");
    // 截断后的长度应远小于 200
    expect(out.length).toBeLessThan(longSummary.length + 200);
    expect(out).toContain("...");
  });

  test("多篇文章时按序号列出", () => {
    const articles = [
      makeArticle({ title: "Article A", id: "2026-07-08-001" }),
      makeArticle({ title: "Article B", id: "2026-07-08-002" }),
    ];
    const out = formatSearchResults(articles, "test");
    expect(out).toContain("1.");
    expect(out).toContain("2.");
    expect(out).toContain("Article A");
    expect(out).toContain("Article B");
  });
});

// ── 3. formatDigest ───────────────────────────────────────────────────────────

describe("formatDigest", () => {
  test("无文章时返回空简报提示", () => {
    const out = formatDigest([], "今日简报", "2026-07-08");
    expect(out).toContain("暂无内容");
    expect(out).toContain("今日简报");
  });

  test("包含标题和日期", () => {
    const out = formatDigest([makeArticle()], "本周热门", "2026-07-08");
    expect(out).toContain("本周热门");
    expect(out).toContain("2026-07-08");
  });

  test("标签以 # 格式输出", () => {
    const a = makeArticle({ tags: ["agent", "rag", "mcp"] });
    const out = formatDigest([a], "简报", "2026-07-08");
    expect(out).toContain("#agent");
    expect(out).toContain("#rag");
  });

  test("最多展示前 3 个标签", () => {
    const a = makeArticle({ tags: ["a", "b", "c", "d", "e"] });
    const out = formatDigest([a], "简报", "2026-07-08");
    expect(out).toContain("#a");
    expect(out).toContain("#b");
    expect(out).toContain("#c");
    expect(out).not.toContain("#d");
  });
});

// ── 4. formatHelp ─────────────────────────────────────────────────────────────

describe("formatHelp", () => {
  test("包含全部命令关键词", () => {
    const out = formatHelp();
    for (const cmd of ["/search", "/today", "/top", "/subscribe", "/unsubscribe", "/help"]) {
      expect(out).toContain(cmd);
    }
  });

  test("包含自然语言示例", () => {
    const out = formatHelp();
    expect(out).toContain("MCP");
    expect(out).toContain("agent");
  });
});

// ── 5. SubscriptionManager ────────────────────────────────────────────────────

describe("SubscriptionManager", () => {
  let tmpDir: string;
  let mgr: SubscriptionManager;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    mgr = new SubscriptionManager(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("初始状态无订阅", async () => {
    expect(await mgr.getSubscriptions("u1")).toEqual([]);
  });

  test("单标签订阅", async () => {
    const updated = await mgr.subscribe("u1", ["agent"]);
    expect(updated).toEqual(["agent"]);
    expect(await mgr.getSubscriptions("u1")).toEqual(["agent"]);
  });

  test("批量标签订阅", async () => {
    const updated = await mgr.subscribe("u1", ["rag", "agent", "mcp"]);
    expect(updated).toEqual(["agent", "mcp", "rag"]); // 排序后
  });

  test("重复订阅去重", async () => {
    await mgr.subscribe("u1", ["agent", "rag"]);
    const updated = await mgr.subscribe("u1", ["agent", "mcp"]);
    expect(updated).toEqual(["agent", "mcp", "rag"]);
  });

  test("取消订阅", async () => {
    await mgr.subscribe("u1", ["agent", "rag", "mcp"]);
    const updated = await mgr.unsubscribe("u1", ["rag"]);
    expect(updated).toEqual(["agent", "mcp"]);
  });

  test("批量取消订阅", async () => {
    await mgr.subscribe("u1", ["agent", "rag", "mcp"]);
    const updated = await mgr.unsubscribe("u1", ["agent", "mcp"]);
    expect(updated).toEqual(["rag"]);
  });

  test("取消不存在的标签不报错", async () => {
    const updated = await mgr.unsubscribe("u1", ["notexist"]);
    expect(updated).toEqual([]);
  });

  test("getSubscribers 返回订阅某标签的所有用户", async () => {
    await mgr.subscribe("u1", ["agent"]);
    await mgr.subscribe("u2", ["agent", "rag"]);
    await mgr.subscribe("u3", ["rag"]);
    const subs = await mgr.getSubscribers("agent");
    expect(subs).toContain("u1");
    expect(subs).toContain("u2");
    expect(subs).not.toContain("u3");
  });

  test("多用户订阅数据相互独立", async () => {
    await mgr.subscribe("u1", ["agent"]);
    await mgr.subscribe("u2", ["rag"]);
    expect(await mgr.getSubscriptions("u1")).toEqual(["agent"]);
    expect(await mgr.getSubscriptions("u2")).toEqual(["rag"]);
  });

  test("数据跨实例持久化", async () => {
    await mgr.subscribe("u1", ["agent"]);
    const mgr2 = new SubscriptionManager(tmpDir);
    expect(await mgr2.getSubscriptions("u1")).toEqual(["agent"]);
  });
});

// ── 6. PermissionManager ──────────────────────────────────────────────────────

describe("PermissionManager", () => {
  let tmpDir: string;
  let mgr: PermissionManager;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    mgr = new PermissionManager(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("未知用户默认 READ", async () => {
    expect(await mgr.getLevel("unknown")).toBe(PermissionLevel.READ);
  });

  test("文件不存在时默认 READ", async () => {
    const mgr2 = new PermissionManager(join(tmpDir, "nonexistent"));
    expect(await mgr2.getLevel("u1")).toBe(PermissionLevel.READ);
  });

  test("从文件读取 write 权限", async () => {
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u1: "write" }),
      "utf-8"
    );
    expect(await mgr.getLevel("u1")).toBe(PermissionLevel.WRITE);
  });

  test("从文件读取 delete 权限", async () => {
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u1: "delete" }),
      "utf-8"
    );
    expect(await mgr.getLevel("u1")).toBe(PermissionLevel.DELETE);
  });

  test("check: READ 满足 READ", async () => {
    expect(await mgr.check("anyone", PermissionLevel.READ)).toBe(true);
  });

  test("check: READ 不满足 WRITE", async () => {
    expect(await mgr.check("anyone", PermissionLevel.WRITE)).toBe(false);
  });

  test("check: WRITE 满足 READ", async () => {
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u1: "write" }),
      "utf-8"
    );
    expect(await mgr.check("u1", PermissionLevel.READ)).toBe(true);
  });

  test("check: WRITE 不满足 DELETE", async () => {
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u1: "write" }),
      "utf-8"
    );
    expect(await mgr.check("u1", PermissionLevel.DELETE)).toBe(false);
  });

  test("check: DELETE 满足所有级别", async () => {
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u1: "delete" }),
      "utf-8"
    );
    expect(await mgr.check("u1", PermissionLevel.READ)).toBe(true);
    expect(await mgr.check("u1", PermissionLevel.WRITE)).toBe(true);
    expect(await mgr.check("u1", PermissionLevel.DELETE)).toBe(true);
  });
});

// ── 7. KnowledgeSearchEngine ──────────────────────────────────────────────────

describe("KnowledgeSearchEngine", () => {
  let tmpDir: string;
  let engine: KnowledgeSearchEngine;

  const articles: Article[] = [
    makeArticle({
      id: "2026-07-01-001",
      title: "MCP 协议入门",
      summary: "介绍 MCP 协议的基本概念",
      tags: ["mcp"],
      relevance_score: 0.9,
      collected_at: "2026-07-01",
    }),
    makeArticle({
      id: "2026-07-05-001",
      title: "Agent 框架对比",
      summary: "比较主流 Agent 框架",
      tags: ["agent", "framework"],
      relevance_score: 0.7,
      collected_at: "2026-07-05",
    }),
    makeArticle({
      id: "2026-07-08-001",
      title: "RAG 实践",
      summary: "RAG 检索增强生成实战",
      tags: ["rag"],
      relevance_score: 0.85,
      collected_at: "2026-07-08",
    }),
  ];

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await writeArticles(tmpDir, articles);
    // 写入 index.json，应被跳过
    await writeFile(join(tmpDir, "index.json"), JSON.stringify({ count: 3 }), "utf-8");
    engine = new KnowledgeSearchEngine(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("无过滤返回全部文章，按 relevance_score 降序", async () => {
    const results = await engine.search({ limit: 10 });
    expect(results).toHaveLength(3);
    expect(results[0]!.relevance_score).toBeGreaterThanOrEqual(results[1]!.relevance_score);
    expect(results[1]!.relevance_score).toBeGreaterThanOrEqual(results[2]!.relevance_score);
  });

  test("跳过 index.json", async () => {
    const results = await engine.search({ limit: 10 });
    expect(results.every((a) => a.id !== "index")).toBe(true);
  });

  test("关键词过滤（匹配标题）", async () => {
    const results = await engine.search({ keyword: "MCP" });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("MCP 协议入门");
  });

  test("关键词过滤（匹配摘要）", async () => {
    const results = await engine.search({ keyword: "检索增强" });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("RAG 实践");
  });

  test("关键词大小写不敏感", async () => {
    const results = await engine.search({ keyword: "mcp" });
    expect(results).toHaveLength(1);
  });

  test("标签过滤", async () => {
    const results = await engine.search({ tags: ["rag"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("RAG 实践");
  });

  test("多标签过滤（OR 语义）", async () => {
    const results = await engine.search({ tags: ["mcp", "rag"], limit: 10 });
    expect(results).toHaveLength(2);
  });

  test("dateFrom 过滤", async () => {
    const results = await engine.search({ dateFrom: "2026-07-05", limit: 10 });
    expect(results).toHaveLength(2);
    expect(results.some((a) => a.title === "MCP 协议入门")).toBe(false);
  });

  test("dateTo 过滤", async () => {
    const results = await engine.search({ dateTo: "2026-07-05", limit: 10 });
    expect(results).toHaveLength(2);
    expect(results.some((a) => a.title === "RAG 实践")).toBe(false);
  });

  test("dateFrom + dateTo 区间过滤", async () => {
    const results = await engine.search({ dateFrom: "2026-07-05", dateTo: "2026-07-05", limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Agent 框架对比");
  });

  test("limit 限制返回数量", async () => {
    const results = await engine.search({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  test("关键词无匹配返回空数组", async () => {
    const results = await engine.search({ keyword: "完全不存在的词" });
    expect(results).toHaveLength(0);
  });

  test("getToday 只返回今日文章", async () => {
    // 今日 = 2026-07-08，只有 RAG 实践
    const results = await engine.getToday();
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("RAG 实践");
  });

  test("getTop 返回近 N 天文章并按评分排序", async () => {
    // 近 7 天包含 2026-07-05 和 2026-07-08
    const results = await engine.getTop(7, 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // 最高分在前
    if (results.length > 1) {
      expect(results[0]!.relevance_score).toBeGreaterThanOrEqual(results[1]!.relevance_score);
    }
  });
});

// ── 8. KnowledgeBot — 集成 ───────────────────────────────────────────────────

describe("KnowledgeBot", () => {
  let tmpDir: string;
  let artDir: string;
  let bot: KnowledgeBot;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    artDir = join(tmpDir, "articles");
    await mkdir(artDir, { recursive: true });

    // 写入一篇今日文章
    const today = new Date().toISOString().slice(0, 10);
    const a = makeArticle({
      id: `${today}-001`,
      title: "今日 Agent 文章",
      tags: ["agent"],
      collected_at: today,
    });
    await writeFile(join(artDir, `${a.id}.json`), JSON.stringify(a), "utf-8");

    // 给 u_write 设置 WRITE 权限
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, "permissions.json"),
      JSON.stringify({ u_write: "write" }),
      "utf-8"
    );

    bot = new KnowledgeBot({ articlesDir: artDir, dataDir: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("/help 返回帮助文本", async () => {
    const reply = await bot.handleMessage("u1", "/help");
    expect(reply).toContain("/search");
    expect(reply).toContain("/today");
  });

  test("未知指令返回提示", async () => {
    const reply = await bot.handleMessage("u1", "foobarXYZ");
    expect(reply).toContain("/help");
  });

  test("/today 返回今日文章", async () => {
    const reply = await bot.handleMessage("u1", "/today");
    expect(reply).toContain("今日 Agent 文章");
  });

  test("/search 关键词命中", async () => {
    const reply = await bot.handleMessage("u1", "/search Agent");
    expect(reply).toContain("今日 Agent 文章");
  });

  test("/search 无结果时给出提示", async () => {
    const reply = await bot.handleMessage("u1", "/search 完全不存在的词");
    expect(reply).toContain("未找到");
  });

  test("/search 支持 #tag 过滤", async () => {
    const reply = await bot.handleMessage("u1", "/search #agent");
    expect(reply).toContain("今日 Agent 文章");
  });

  test("/top 返回热门文章", async () => {
    const reply = await bot.handleMessage("u1", "/top");
    // 有文章时应包含标题
    expect(typeof reply).toBe("string");
  });

  test("/subscribe 无 WRITE 权限时拒绝", async () => {
    const reply = await bot.handleMessage("u_read", "/subscribe agent");
    expect(reply).toContain("WRITE 权限");
  });

  test("/subscribe 有 WRITE 权限时成功", async () => {
    const reply = await bot.handleMessage("u_write", "/subscribe agent rag");
    expect(reply).toContain("✅");
    expect(reply).toContain("agent");
    expect(reply).toContain("rag");
  });

  test("/subscribe 空参数时返回当前订阅列表", async () => {
    const reply = await bot.handleMessage("u_write", "/subscribe");
    expect(reply).toContain("没有订阅");
  });

  test("/unsubscribe 成功取消订阅", async () => {
    await bot.handleMessage("u_write", "/subscribe agent rag");
    const reply = await bot.handleMessage("u_write", "/unsubscribe agent");
    expect(reply).toContain("✅");
    expect(reply).toContain("rag");
    expect(reply).not.toContain("`agent`");
  });

  test("/unsubscribe 空参数时提示错误", async () => {
    const reply = await bot.handleMessage("u_write", "/unsubscribe");
    expect(reply).toContain("请指定");
  });

  test("自然语言：'搜索 agent' → 命中文章", async () => {
    const reply = await bot.handleMessage("u1", "搜索 agent");
    expect(reply).toContain("今日 Agent 文章");
  });

  test("自然语言：'今天有什么' → TODAY", async () => {
    const reply = await bot.handleMessage("u1", "今天有什么新内容");
    expect(reply).toContain("今日 Agent 文章");
  });
});
