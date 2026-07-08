import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import {
  type Article,
  generateDailyDigest,
} from "../distribution/formatter.js";

// ── 枚举 ─────────────────────────────────────────────────────────────────────

export enum Intent {
  SEARCH = "search",
  TODAY = "today",
  TOP = "top",
  SUBSCRIBE = "subscribe",
  UNSUBSCRIBE = "unsubscribe",
  HELP = "help",
  UNKNOWN = "unknown",
}

export enum PermissionLevel {
  READ = 0,
  WRITE = 1,
  DELETE = 2,
}

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  keyword?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/** 用户信息。 */
export interface User {
  /** 用户唯一标识。 */
  userId: string;
  /** 用户名（可选）。 */
  username: string;
  /** 权限级别，默认 READ。 */
  permission: PermissionLevel;
  /** 当前订阅的标签列表。 */
  subscriptions: string[];
  /** 创建时间，ISO 格式。 */
  createdAt: string;
}

// ── 1. KnowledgeSearchEngine ──────────────────────────────────────────────────

/**
 * 从 `knowledge/articles/*.json` 加载并搜索文章。
 * 结果按 `relevance_score` 降序排列。
 */
export class KnowledgeSearchEngine {
  private readonly articlesDir: string;

  constructor(articlesDir = "knowledge/articles") {
    this.articlesDir = articlesDir;
  }

  /** 加载全部文章，跳过 index.json。 */
  private async loadAll(): Promise<Article[]> {
    const files = await readdir(this.articlesDir);
    const jsonFiles = files.filter(
      (f) => f.endsWith(".json") && f !== "index.json"
    );
    const articles = await Promise.all(
      jsonFiles.map(async (f) => {
        const raw = await readFile(join(this.articlesDir, f), "utf-8");
        return JSON.parse(raw) as Article;
      })
    );
    return articles.sort((a, b) => b.relevance_score - a.relevance_score);
  }

  /**
   * 按关键词、标签、日期范围搜索文章。
   *
   * @param opts - 过滤选项，所有字段均可选。
   * @returns 匹配的文章列表，按 relevance_score 降序。
   */
  async search(opts: SearchOptions = {}): Promise<Article[]> {
    const { keyword, tags, dateFrom, dateTo, limit = 20 } = opts;
    let articles = await this.loadAll();

    if (keyword) {
      const kw = keyword.toLowerCase();
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(kw) ||
          a.summary.toLowerCase().includes(kw) ||
          (a.key_insight ?? "").toLowerCase().includes(kw) ||
          a.tags.some((t) => t.toLowerCase().includes(kw))
      );
    }

    if (tags && tags.length > 0) {
      const lowerTags = tags.map((t) => t.toLowerCase());
      articles = articles.filter((a) =>
        lowerTags.some((t) => a.tags.map((x) => x.toLowerCase()).includes(t))
      );
    }

    if (dateFrom) {
      articles = articles.filter(
        (a) => (a.collected_at ?? a.id).slice(0, 10) >= dateFrom
      );
    }
    if (dateTo) {
      articles = articles.filter(
        (a) => (a.collected_at ?? a.id).slice(0, 10) <= dateTo
      );
    }

    return articles.slice(0, limit);
  }

  /**
   * 获取今日收录的文章。
   *
   * @param limit - 最大返回条数。
   */
  async getToday(limit = 20): Promise<Article[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.search({ dateFrom: today, dateTo: today, limit });
  }

  /**
   * 获取近 N 天评分最高的文章。
   *
   * @param days - 回溯天数（默认 7）。
   * @param limit - 最大返回条数。
   */
  async getTop(days = 7, limit = 10): Promise<Article[]> {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    const dateFrom = from.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);
    return this.search({ dateFrom, dateTo, limit });
  }
}

// ── 2. SubscriptionManager ────────────────────────────────────────────────────

type SubscriptionStore = Record<string, string[]>;

/**
 * 用户主题订阅管理，持久化到 `data/subscriptions.json`。
 */
export class SubscriptionManager {
  private readonly filePath: string;

  constructor(dataDir = "data") {
    this.filePath = join(dataDir, "subscriptions.json");
  }

  private async load(): Promise<SubscriptionStore> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as SubscriptionStore;
    } catch {
      return {};
    }
  }

  private async save(store: SubscriptionStore): Promise<void> {
    await mkdir(join(this.filePath, ".."), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }

  /**
   * 为用户批量添加标签订阅。
   *
   * @param userId - 用户 ID。
   * @param tags - 要订阅的标签列表。
   * @returns 更新后的完整订阅列表（已排序去重）。
   */
  async subscribe(userId: string, tags: string[]): Promise<string[]> {
    const store = await this.load();
    const current = new Set(store[userId] ?? []);
    for (const tag of tags) current.add(tag);
    store[userId] = [...current].sort();
    await this.save(store);
    return store[userId];
  }

  /**
   * 为用户批量取消标签订阅。
   *
   * @param userId - 用户 ID。
   * @param tags - 要取消的标签列表。
   * @returns 更新后的完整订阅列表（已排序）。
   */
  async unsubscribe(userId: string, tags: string[]): Promise<string[]> {
    const store = await this.load();
    const current = new Set(store[userId] ?? []);
    for (const tag of tags) current.delete(tag);
    store[userId] = [...current].sort();
    await this.save(store);
    return store[userId];
  }

  /** 获取用户的全部订阅主题。 */
  async getSubscriptions(userId: string): Promise<string[]> {
    const store = await this.load();
    return store[userId] ?? [];
  }

  /** 获取订阅某主题的全部用户 ID。 */
  async getSubscribers(topic: string): Promise<string[]> {
    const store = await this.load();
    return Object.entries(store)
      .filter(([, topics]) => topics.includes(topic))
      .map(([uid]) => uid);
  }
}

// ── 3. PermissionManager ──────────────────────────────────────────────────────

type PermissionStore = Record<string, "read" | "write" | "delete">;

/**
 * 三级权限系统，持久化到 `data/permissions.json`。
 * 未知用户默认为 READ。
 */
export class PermissionManager {
  private readonly filePath: string;

  constructor(dataDir = "data") {
    this.filePath = join(dataDir, "permissions.json");
  }

  private async load(): Promise<PermissionStore> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as PermissionStore;
    } catch {
      return {};
    }
  }

  private storedToLevel(stored: "read" | "write" | "delete"): PermissionLevel {
    if (stored === "write") return PermissionLevel.WRITE;
    if (stored === "delete") return PermissionLevel.DELETE;
    return PermissionLevel.READ;
  }

  /** 获取用户权限级别，默认为 READ。 */
  async getLevel(userId: string): Promise<PermissionLevel> {
    const store = await this.load();
    return store[userId] ? this.storedToLevel(store[userId]) : PermissionLevel.READ;
  }

  /**
   * 检查用户是否满足所需权限级别。
   *
   * @param userId - 待检查的用户 ID。
   * @param required - 最低所需权限级别。
   */
  async check(userId: string, required: PermissionLevel): Promise<boolean> {
    const level = await this.getLevel(userId);
    return level >= required;
  }
}

// ── 4. 意图识别 ───────────────────────────────────────────────────────────────

/**
 * 意图识别规则表：[意图, 正则（含捕获组提取参数）]。
 * 顺序即优先级，unsubscribe 必须排在 subscribe 之前。
 */
const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  [Intent.SEARCH,      /(?:搜索|查询|查找|搜|找|search|find|关于)\s*(.+)/i],
  [Intent.TODAY,       /(?:今[天日]|简报|摘要|today|daily|digest)/i],
  [Intent.TOP,         /(?:热门|top|排行|热榜|trending|本周)/i],
  [Intent.UNSUBSCRIBE, /(?:取消订阅|unsubscribe)\s*(.*)/i],
  [Intent.SUBSCRIBE,   /(?:订阅|subscribe)\s*(.+)/i],
  [Intent.HELP,        /(?:帮助|help|命令|怎么用|使用说明|\?|？)/i],
];

/**
 * 基于规则的意图识别，不调用 LLM。
 *
 * 优先匹配命令前缀（`/search` 等），再用 `INTENT_PATTERNS` 正则匹配自然语言。
 * 正则含捕获组时自动提取参数，无需在 handler 层二次处理。
 *
 * @param text - 用户原始消息。
 * @returns `[Intent, 参数字符串]` 元组。
 */
export function recognizeIntent(text: string): [Intent, string] {
  const t = text.trim();

  // 命令前缀匹配（最高优先级）
  if (/^\/search\b/i.test(t))      return [Intent.SEARCH,      t.replace(/^\/search\s*/i, "").trim()];
  if (/^\/today\b/i.test(t))       return [Intent.TODAY,       ""];
  if (/^\/top\b/i.test(t))         return [Intent.TOP,         t.replace(/^\/top\s*/i, "").trim()];
  if (/^\/unsubscribe\b/i.test(t)) return [Intent.UNSUBSCRIBE, t.replace(/^\/unsubscribe\s*/i, "").trim()];
  if (/^\/subscribe\b/i.test(t))   return [Intent.SUBSCRIBE,   t.replace(/^\/subscribe\s*/i, "").trim()];
  if (/^\/help\b/i.test(t))        return [Intent.HELP,        ""];

  // 自然语言：用捕获组提取参数
  for (const [intent, pattern] of INTENT_PATTERNS) {
    const m = pattern.exec(t);
    if (m) {
      const args = (m[1] ?? "").trim();
      return [intent, args];
    }
  }

  return [Intent.UNKNOWN, t];
}

// ── 5. 响应格式化 ─────────────────────────────────────────────────────────────

/**
 * 将搜索结果列表渲染为用户可读的 Markdown 文本。
 *
 * @param articles - 搜索命中的文章列表。
 * @param query - 原始查询词，用于提示信息。
 * @returns 格式化后的 Markdown 字符串。
 */
export function formatSearchResults(articles: Article[], query = ""): string {
  if (articles.length === 0) {
    const tip = "💡 试试换个关键词，或去掉时间限制。";
    return query
      ? `🔍 未找到与「${query}」相关的内容。\n${tip}`
      : `🔍 暂无内容。\n${tip}`;
  }

  const lines = [`🔍 找到 ${articles.length} 条与「${query}」相关的内容：\n`];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const score = a.relevance_score.toFixed(1);
    const tags = a.tags.slice(0, 3).join(", ");
    const date = (a.collected_at ?? a.id).slice(0, 10);
    lines.push(
      `📌 ${i + 1}. **${a.title}**`,
      `   ${a.summary.slice(0, 80)}...`,
      `   📊 ${score} | ${a.source} | ${date} | ${tags}`,
      `   🔗 ${a.url}`,
      ""
    );
  }
  return lines.join("\n");
}

/**
 * 将文章列表渲染为简报格式。
 *
 * @param articles - 文章列表。
 * @param title - 简报标题，默认"今日简报"。
 * @param date - 日期字符串（YYYY-MM-DD）。
 * @returns 格式化后的 Markdown 字符串。
 */
export function formatDigest(
  articles: Article[],
  title = "今日简报",
  date: string
): string {
  if (articles.length === 0) return `📭 ${title}：暂无内容。`;

  const lines = [`📰 **${title}** — ${date}\n`];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const tags = a.tags
      .slice(0, 3)
      .map((t) => `#${t}`)
      .join(" ");
    lines.push(
      `${i + 1}. **${a.title}**`,
      `   ${a.summary.slice(0, 60)}...`,
      `   ${tags}`,
      ""
    );
  }
  return lines.join("\n");
}

/**
 * 生成帮助文本。
 *
 * @returns 格式化后的帮助 Markdown 字符串。
 */
export function formatHelp(): string {
  return [
    "🤖 **AI 知识库助手** — 使用指南",
    "",
    "📋 **命令列表**：",
    "  `/search <关键词>`    — 搜索知识库",
    "  `/today`              — 查看今日简报",
    "  `/top [N]`            — 近 N 天热门（默认 7 天）",
    "  `/subscribe <标签>`   — 订阅主题（需要 WRITE 权限）",
    "  `/unsubscribe <标签>` — 取消订阅（需要 WRITE 权限）",
    "  `/help`               — 显示本帮助",
    "",
    "💬 **自然语言**：",
    '  你也可以直接用中文描述需求，例如：',
    '  - "搜索 MCP 协议相关的文章"',
    '  - "今天有什么新内容？"',
    '  - "帮我订阅 agent 和 rag 标签"',
    "",
    "📊 **知识来源**：GitHub Trending, Hacker News, arXiv",
    "🕐 **更新频率**：每日自动采集",
  ].join("\n");
}

// ── 6. KnowledgeBot ──────────────────────────────────────────────────────────

/**
 * Bot 主入口，将消息分发到各处理器方法。
 */
export class KnowledgeBot {
  private readonly engine: KnowledgeSearchEngine;
  private readonly subscriptions: SubscriptionManager;
  private readonly permissions: PermissionManager;
  private readonly articlesDir: string;

  constructor(
    opts: {
      articlesDir?: string;
      dataDir?: string;
    } = {}
  ) {
    const { articlesDir = "knowledge/articles", dataDir = "data" } = opts;
    this.articlesDir = articlesDir;
    this.engine = new KnowledgeSearchEngine(articlesDir);
    this.subscriptions = new SubscriptionManager(dataDir);
    this.permissions = new PermissionManager(dataDir);
  }

  /**
   * 处理用户消息的统一入口。
   *
   * @param userId - 用户唯一标识。
   * @param text - 原始消息文本。
   * @returns 返回给用户的响应字符串。
   */
  async handleMessage(userId: string, text: string): Promise<string> {
    const [intent, args] = recognizeIntent(text);

    switch (intent) {
      case Intent.SEARCH:      return this._handleSearch(userId, args);
      case Intent.TODAY:       return this._handleToday(userId);
      case Intent.TOP:         return this._handleTop(userId, args);
      case Intent.SUBSCRIBE:   return this._handleSubscribe(userId, args);
      case Intent.UNSUBSCRIBE: return this._handleUnsubscribe(userId, args);
      case Intent.HELP:        return this._handleHelp();
      default:                 return this._handleUnknown(text);
    }
  }

  private async _handleSearch(userId: string, args: string): Promise<string> {
    const canRead = await this.permissions.check(userId, PermissionLevel.READ);
    if (!canRead) return "权限不足：需要 READ 权限。";

    // 提取 #tag 格式的标签，剩余部分作为关键词
    const tags = (args.match(/#(\S+)/g) ?? []).map((t) => t.slice(1));
    const keyword = args.replace(/#\S+/g, "").trim() || undefined;

    const articles = await this.engine.search({ keyword, tags: tags.length ? tags : undefined, limit: 5 });
    return formatSearchResults(articles, args);
  }

  private async _handleToday(userId: string): Promise<string> {
    const canRead = await this.permissions.check(userId, PermissionLevel.READ);
    if (!canRead) return "权限不足：需要 READ 权限。";

    const today = new Date().toISOString().slice(0, 10);
    const digest = await generateDailyDigest({ date: today, knowledgeDir: this.articlesDir });

    if (digest.total === 0) return `今日（${today}）暂无新文章。`;
    return digest.markdown;
  }

  private async _handleTop(userId: string, args: string): Promise<string> {
    const canRead = await this.permissions.check(userId, PermissionLevel.READ);
    if (!canRead) return "权限不足：需要 READ 权限。";

    const daysMatch = args.match(/(\d+)/);
    const days = daysMatch ? parseInt(daysMatch[1], 10) : 7;
    const articles = await this.engine.getTop(days, 10);
    const date = new Date().toISOString().slice(0, 10);
    return formatDigest(articles, `近 ${days} 天热门 Top ${articles.length}`, date);
  }

  private async _handleSubscribe(userId: string, args: string): Promise<string> {
    const canWrite = await this.permissions.check(userId, PermissionLevel.WRITE);
    if (!canWrite) return "⚠️ 订阅功能需要 WRITE 权限。请联系管理员开通。";

    if (!args) {
      const current = await this.subscriptions.getSubscriptions(userId);
      if (current.length > 0) {
        return `📋 当前订阅：${current.map((t) => `\`${t}\``).join(", ")}\n\n使用 \`/subscribe <标签>\` 添加新订阅。`;
      }
      return "📋 你还没有订阅任何标签。\n\n使用 `/subscribe llm agent rag` 订阅感兴趣的主题。";
    }

    // 支持空格或逗号分隔的批量标签
    const tags = args.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const updated = await this.subscriptions.subscribe(userId, tags);
    return `✅ 订阅成功！当前订阅：${updated.map((t) => `\`${t}\``).join(", ")}`;
  }

  private async _handleUnsubscribe(userId: string, args: string): Promise<string> {
    const canWrite = await this.permissions.check(userId, PermissionLevel.WRITE);
    if (!canWrite) return "⚠️ 取消订阅需要 WRITE 权限。";

    if (!args) return "请指定要取消的标签。\n例如：`/unsubscribe llm`";

    const tags = args.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const updated = await this.subscriptions.unsubscribe(userId, tags);
    if (updated.length > 0) {
      return `✅ 已取消订阅。剩余订阅：${updated.map((t) => `\`${t}\``).join(", ")}`;
    }
    return "✅ 已取消订阅。当前无任何订阅。";
  }

  private _handleHelp(): string {
    return formatHelp();
  }

  private _handleUnknown(text: string): string {
    return [
      "🤔 我没有理解你的意思。",
      "",
      "你可以试试：",
      "- 搜索 MCP 协议",
      "- /today 查看今日简报",
      "- /help 查看完整命令列表",
    ].join("\n");
  }
}

// ── CLI 入口 ──────────────────────────────────────────────────────────────────

/** 启动 CLI 会话。可传入命令行参数，或进入交互模式。 */
export async function runCli(): Promise<void> {
  const bot = new KnowledgeBot();
  const userId = process.env.BOT_USER_ID ?? "cli-user";

  const args = process.argv.slice(2);
  if (args.length > 0) {
    const reply = await bot.handleMessage(userId, args.join(" "));
    console.log(reply);
    return;
  }

  // 交互模式
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("知识库 Bot 已启动。输入 /help 查看帮助，Ctrl-C 退出。\n");

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;
    const reply = await bot.handleMessage(userId, text);
    console.log("\n" + reply + "\n");
  });
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("knowledge-bot.ts") ||
    process.argv[1].endsWith("knowledge-bot.js"))
) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
