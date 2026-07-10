import { readdir, readFile } from "fs/promises";
import { join } from "path";

export interface Article {
  id: string;
  title: string;
  source: string;
  url: string;
  collected_at?: string;
  summary: string;
  tags: string[];
  relevance_score: number;
  category: string;
  key_insight?: string;
}

// ── category bucketing ────────────────────────────────────────────────────────

const BUCKET_PRIORITY: string[] = [
  "mcp",
  "agent",
  "rag",
  "fine-tuning",
  "framework",
  "tool",
  "paper",
  "benchmark",
  "tutorial",
];

const BUCKET_LABEL: Record<string, string> = {
  mcp: "MCP",
  agent: "Agent",
  rag: "RAG",
  "fine-tuning": "Fine-tuning",
  framework: "Framework",
  tool: "Tool",
  paper: "Paper",
  benchmark: "Benchmark",
  tutorial: "Tutorial",
  other: "Other",
};

const TAG_TO_BUCKET: Record<string, string> = {
  mcp: "mcp",
  "agent-framework": "agent",
  "multi-agent": "agent",
  rag: "rag",
  "vector-database": "rag",
  "knowledge-graph": "rag",
  "document-qa": "rag",
  "fine-tuning": "fine-tuning",
  "prompt-engineering": "fine-tuning",
  "large-language-model": "framework",
  transformer: "framework",
  embedding: "framework",
  "code-generation": "tool",
  "code-assistant": "tool",
  chatbot: "tool",
  "data-analysis": "tool",
  "workflow-automation": "tool",
  langchain: "tool",
  llamaindex: "tool",
  openai: "tool",
  anthropic: "tool",
  deepseek: "tool",
  huggingface: "tool",
};

const CATEGORY_TO_BUCKET: Record<string, string> = {
  // English (upstream spec)
  framework: "framework",
  tool: "tool",
  paper: "paper",
  benchmark: "benchmark",
  tutorial: "tutorial",
  // Chinese (current pipeline output)
  ai代理框架: "agent",
  ai应用框架: "framework",
  ai开发平台: "framework",
  "ai基础设施/工具": "tool",
  "ai基础设施/优化工具": "tool",
  ai应用与工具: "tool",
  模型微调框架: "fine-tuning",
  开发工具与平台: "tool",
  学习资源: "tutorial",
  数据库技术: "tool",
};

function bucketOf(article: Article): string {
  for (const tag of article.tags ?? []) {
    const b = TAG_TO_BUCKET[tag.toLowerCase()];
    if (b) return b;
  }
  const cb = CATEGORY_TO_BUCKET[article.category?.toLowerCase() ?? ""];
  if (cb) return cb;
  return "other";
}

// ── helpers ──────────────────────────────────────────────────────────────────

function scoreEmoji(score: number): string {
  if (score >= 0.8) return "🟢";
  if (score >= 0.6) return "🟡";
  return "🔴";
}

function scoreColor(score: number): "green" | "yellow" | "red" {
  if (score >= 0.8) return "green";
  if (score >= 0.6) return "yellow";
  return "red";
}

function dateOnly(article: Pick<Article, "id" | "collected_at">): string {
  return (article.collected_at ?? article.id).slice(0, 10);
}

/** Escape all Telegram MarkdownV2 special characters. */
function escapeTgMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, (c) => `\\${c}`);
}

// ── 1. Markdown ───────────────────────────────────────────────────────────────

export function jsonToMarkdown(article: Article): string {
  const emoji = scoreEmoji(article.relevance_score);
  const date = dateOnly(article);
  const tagLine = article.tags.map((t) => `\`${t}\``).join(" ");

  return [
    `# ${article.title}`,
    "",
    `| 字段 | 值 |`,
    `|------|-----|`,
    `| 来源 | ${article.source} |`,
    `| 日期 | ${date} |`,
    `| 相关性 | ${emoji} ${article.relevance_score.toFixed(2)} |`,
    `| 分类 | ${article.category} |`,
    "",
    `**标签：** ${tagLine}`,
    "",
    `## 摘要`,
    "",
    article.summary,
    "",
    ...(article.key_insight
      ? [`> **核心洞察：** ${article.key_insight}`, ""]
      : []),
    `[阅读原文](${article.url})`,
  ].join("\n");
}

// ── 2. Telegram MarkdownV2 ────────────────────────────────────────────────────

// export function jsonToTelegram(article: Article): string {
//   const emoji = scoreEmoji(article.relevance_score);
//   const date = escapeTgMd(dateOnly(article.collected_at));
//   const score = escapeTgMd(article.relevance_score.toFixed(2));
//   const source = escapeTgMd(article.source);
//   const summary = escapeTgMd(article.summary);
//   const tags = article.tags
//     .map((t) => `#${escapeTgMd(t.replace(/\s+/g, "_"))}`)
//     .join(" ");

//   // Title as hyperlink — title and url must be escaped inside [text](url)
//   const titleEscaped = escapeTgMd(article.title);
//   const urlEscaped = article.url.replace(/[)\\]/g, (c) => `\\${c}`);
//   const titleLink = `[${titleEscaped}](${urlEscaped})`;

//   return [
//     `*${titleLink}*`,
//     "",
//     summary,
//     "",
//     `${emoji} 相关性：${score}　来源：${source}　日期：${date}`,
//     "",
//     tags,
//   ].join("\n");
// }

// ── 3. Feishu Interactive Card ────────────────────────────────────────────────

/** 单篇文章元数据块（来源 / 相关性 / 分类 / 标签分行）。 */
function feishuArticleMetaLines(article: Article): string {
  const emoji = scoreEmoji(article.relevance_score);
  const tagLine = article.tags.length > 0 ? article.tags.join(" | ") : "—";
  const lines = [
    `**来源** ${article.source}`,
    `**相关性** ${emoji} ${article.relevance_score.toFixed(1)}`,
  ];
  if (article.category) {
    lines.push(`**分类** ${article.category}`);
  }
  lines.push(`**标签** ${tagLine}`);
  return lines.join("\n");
}

/** 单篇文章卡片 body 元素（摘要 + 元数据 + 洞察 + 链接）。 */
function feishuArticleBodyElements(
  article: Article,
  index?: number,
): object[] {
  const elements: object[] = [];

  if (index !== undefined) {
    elements.push({
      tag: "markdown",
      content: `**${index}. ${article.title}**`,
    });
  }

  elements.push(
    { tag: "markdown", content: article.summary },
    { tag: "markdown", content: feishuArticleMetaLines(article) },
  );

  if (article.key_insight) {
    elements.push({
      tag: "markdown",
      content: `**核心洞察** ${article.key_insight}`,
    });
  }

  elements.push({
    tag: "markdown",
    content: `[阅读原文](${article.url})`,
  });

  return elements;
}

/** 单篇文章飞书卡片（独立推送场景）。 */
export function jsonToFeishu(article: Article): object {
  const color = scoreColor(article.relevance_score);
  const date = dateOnly(article);

  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        template: color,
        title: {
          tag: "plain_text",
          content: article.title,
        },
        subtitle: {
          tag: "plain_text",
          content: date,
        },
      },
      body: {
        elements: feishuArticleBodyElements(article),
      },
    },
  };
}

/** 空简报的飞书卡片。 */
export function buildEmptyFeishuCard(date: string): object {
  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        template: "grey",
        title: {
          tag: "plain_text",
          content: `📭 知识库日报 ${date}`,
        },
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: "今日暂无新增知识条目。",
          },
        ],
      },
    },
  };
}

/**
 * 构建每日汇总飞书卡片：一条消息，内含多篇文章，每篇样式同 jsonToFeishu。
 */
export function buildFeishuDigest(date: string, articles: Article[]): object {
  if (articles.length === 0) {
    return buildEmptyFeishuCard(date);
  }

  const elements: object[] = [];

  for (let i = 0; i < articles.length; i++) {
    elements.push(...feishuArticleBodyElements(articles[i]!, i + 1));
    if (i < articles.length - 1) {
      elements.push({ tag: "markdown", content: "---" });
    }
  }

  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      header: {
        template: "blue",
        title: {
          tag: "plain_text",
          content: `📰 知识库日报 ${date}`,
        },
        subtitle: {
          tag: "plain_text",
          content: `精选 ${articles.length} 篇`,
        },
      },
      body: { elements },
    },
  };
}

// ── 4. Daily Digest ───────────────────────────────────────────────────────────

interface DigestOptions {
  knowledgeDir?: string;
  date?: string; // YYYY-MM-DD; defaults to today
  topN?: number;
}

interface DailyDigest {
  date: string;
  total: number;
  articles: Article[];
  markdown: string;
  /** 每日汇总单张飞书卡片（内含多篇，样式同单篇卡片）。 */
  feishu: object;
}

type BucketMap = Map<string, Article[]>;

/** Pure: group articles by bucket, each bucket sorted desc by score, capped at topN. */
export function groupByBucket(articles: Article[], topN: number): BucketMap {
  const map = new Map<string, Article[]>();
  for (const article of articles) {
    const b = bucketOf(article);
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(article);
  }
  for (const [b, list] of map) {
    map.set(
      b,
      list.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, topN)
    );
  }
  return map;
}

/** Pure: return bucket keys in display order (priority list first, then alpha). */
export function orderedBucketKeys(bucketMap: BucketMap): string[] {
  return [
    ...BUCKET_PRIORITY.filter((b) => bucketMap.has(b)),
    ...[...bucketMap.keys()].filter((b) => !BUCKET_PRIORITY.includes(b)).sort(),
  ];
}

/** Pure: render grouped articles as a Markdown daily digest string. */
export function renderDigestMarkdown(
  date: string,
  total: number,
  bucketMap: BucketMap,
  buckets: string[]
): string {
  const allCount = buckets.reduce((n, b) => n + bucketMap.get(b)!.length, 0);
  const parts = [
    `# 知识库日报 ${date}`,
    "",
    `> 当日收录 **${total}** 篇，精选 ${allCount} 篇`,
    "",
  ];
  for (const bucket of buckets) {
    const list = bucketMap.get(bucket)!;
    parts.push(`## ${BUCKET_LABEL[bucket] ?? bucket}`, "");
    for (let i = 0; i < list.length; i++) {
      parts.push(`### ${i + 1}. ${list[i].title}`, "");
      parts.push(jsonToMarkdown(list[i]), "");
    }
  }
  return parts.join("\n");
}

export async function generateDailyDigest(
  opts: DigestOptions = {}
): Promise<DailyDigest> {
  const {
    knowledgeDir = "knowledge/articles",
    date = new Date().toISOString().slice(0, 10),
    topN = 5,
  } = opts;

  const files = await readdir(knowledgeDir);
  const dayFiles = files.filter(
    (f) => f.startsWith(date) && f.endsWith(".json")
  );
  const articles: Article[] = await Promise.all(
    dayFiles.map(async (f) => {
      const raw = await readFile(join(knowledgeDir, f), "utf-8");
      return JSON.parse(raw) as Article;
    })
  );

  const bucketMap = groupByBucket(articles, topN);
  const buckets = orderedBucketKeys(bucketMap);
  const allTop = buckets.flatMap((b) => bucketMap.get(b)!);

  return {
    date,
    total: articles.length,
    articles: allTop,
    markdown: renderDigestMarkdown(date, articles.length, bucketMap, buckets),
    feishu: buildFeishuDigest(date, allTop),
  };
}
