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

export function jsonToTelegram(article: Article): string {
  const emoji = scoreEmoji(article.relevance_score);
  const date = escapeTgMd(dateOnly(article.collected_at));
  const score = escapeTgMd(article.relevance_score.toFixed(2));
  const source = escapeTgMd(article.source);
  const summary = escapeTgMd(article.summary);
  const tags = article.tags
    .map((t) => `#${escapeTgMd(t.replace(/\s+/g, "_"))}`)
    .join(" ");

  // Title as hyperlink — title and url must be escaped inside [text](url)
  const titleEscaped = escapeTgMd(article.title);
  const urlEscaped = article.url.replace(/[)\\]/g, (c) => `\\${c}`);
  const titleLink = `[${titleEscaped}](${urlEscaped})`;

  return [
    `*${titleLink}*`,
    "",
    summary,
    "",
    `${emoji} 相关性：${score}　来源：${source}　日期：${date}`,
    "",
    tags,
  ].join("\n");
}

// ── 3. Feishu Interactive Card ────────────────────────────────────────────────

export function jsonToFeishu(article: Article): object {
  const color = scoreColor(article.relevance_score);
  const date = dateOnly(article);
  const emoji = scoreEmoji(article.relevance_score);
  const tagText = article.tags.join(" · ");

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
          content: `${article.source} · ${date}`,
        },
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: article.summary,
          },
          {
            tag: "column_set",
            flex_mode: "stretch",
            columns: [
              {
                tag: "column",
                elements: [
                  {
                    tag: "markdown",
                    content: `**相关性** ${emoji} ${article.relevance_score.toFixed(2)}`,
                  },
                ],
              },
              {
                tag: "column",
                elements: [
                  {
                    tag: "markdown",
                    content: `**分类** ${article.category}`,
                  },
                ],
              },
            ],
          },
          ...(tagText
            ? [
                {
                  tag: "markdown",
                  content: `**标签** ${tagText}`,
                },
              ]
            : []),
          ...(article.key_insight
            ? [
                {
                  tag: "markdown",
                  content: `**核心洞察** ${article.key_insight}`,
                },
              ]
            : []),
          {
            tag: "action",
            actions: [
              {
                tag: "button",
                text: { tag: "plain_text", content: "阅读原文" },
                type: "primary",
                url: article.url,
              },
            ],
          },
        ],
      },
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
  feishu: object[];
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

  // Sort by relevance desc, take topN
  const top = articles
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, topN);

  const mdParts = [
    `# 知识库日报 ${date}`,
    "",
    `> 当日收录 **${articles.length}** 篇，精选 Top ${top.length}`,
    "",
  ];

  for (let i = 0; i < top.length; i++) {
    mdParts.push(`---`, "", `## ${i + 1}. ${top[i].title}`, "");
    mdParts.push(jsonToMarkdown(top[i]), "");
  }

  return {
    date,
    total: articles.length,
    articles: top,
    markdown: mdParts.join("\n"),
    feishu: top.map(jsonToFeishu),
  };
}
