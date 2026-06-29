/**
 * 工作流节点定义 — 5 个核心节点
 *
 * 节点调用链:
 *   collect → analyze → organize → review → (conditional) → save
 *                                      ↑                    │
 *                                      └── organize (retry) ┘
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chatJson, accumulateUsage } from "./model-client.ts";
import type { KBState } from "./state.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const ARTICLES_DIR = join(ROOT_DIR, "knowledge", "articles");
const INDEX_FILE = join(ARTICLES_DIR, "index.json");

const GITHUB_SEARCH_URL =
  "https://api.github.com/search/repositories?q=topic:ai+topic:agent&sort=stars&per_page=10";

const ARTICLE_FIELDS = [
  "title",
  "source",
  "url",
  "summary",
  "tags",
  "relevance_score",
  "category",
  "key_insight",
] as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowUtcIso(): string {
  return new Date().toISOString();
}

function isErrorItem(item: Record<string, unknown>): boolean {
  const title = String(item.title ?? "");
  return title.startsWith("[ERROR]");
}

/** chatJson 返回值可能是对象或数组（LLM 直接返回 JSON 数组时）。 */
function asRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value as Record<string, unknown>[];
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).articles)
  ) {
    return (value as Record<string, unknown>).articles as Record<
      string,
      unknown
    >[];
  }
  return null;
}

/** 采集节点：调用 GitHub Search API 获取 AI 相关仓库 */
export async function collectNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[CollectNode] 开始采集 GitHub 仓库");

  const sources: Record<string, unknown>[] = [];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  const token = process.env.GITHUB_TOKEN ?? "";
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const resp = await fetch(GITHUB_SEARCH_URL, { headers });
    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as {
      items?: Array<Record<string, unknown>>;
    };

    if (!data.items?.length) {
      sources.push({
        source: "github",
        title: "[ERROR]",
        description: "GitHub API 返回空结果",
      });
    } else {
      for (const repo of data.items) {
        sources.push({
          source: "github",
          title: repo.full_name as string,
          url: repo.html_url as string,
          description: (repo.description as string | null) ?? "",
          stars: (repo.stargazers_count as number) ?? 0,
          collected_at: nowUtcIso(),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sources.push({
      source: "github",
      title: "[ERROR]",
      description: message,
    });
  }

  console.log(`[CollectNode] 采集到 ${sources.length} 条原始数据`);
  return { sources };
}

/** 分析节点：用 LLM 对每条数据生成中文摘要、标签、评分 */
export async function analyzeNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[AnalyzeNode] 开始 LLM 分析");

  const analyses: Record<string, unknown>[] = [];
  let tracker = { ...state.cost_tracker };

  for (const item of state.sources) {
    if (isErrorItem(item)) continue;

    const prompt = `请分析以下技术项目，用 JSON 格式返回：
项目名: ${item.title}
描述: ${item.description ?? "无描述"}

返回格式: {"summary": "200字中文摘要", "tags": ["标签"], "relevance_score": 0.8, "category": "分类", "key_insight": "一句话洞察"}`;

    try {
      const { parsed, usage } = await chatJson(prompt);
      tracker = accumulateUsage(tracker, usage);
      analyses.push({ ...item, ...parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[AnalyzeNode] 分析失败: ${item.title} - ${message}`);
      analyses.push({
        ...item,
        summary: `分析失败: ${message}`,
        relevance_score: 0.0,
      });
    }
  }

  console.log(`[AnalyzeNode] 完成 ${analyses.length} 条分析`);
  return { analyses, cost_tracker: tracker };
}

/** 整理节点：过滤低分、URL 去重、按审核反馈修正 */
export async function organizeNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[OrganizeNode] 开始整理知识条目");

  const feedback = state.review_feedback.trim();
  const iteration = state.iteration;
  let tracker = { ...state.cost_tracker };

  const qualified = state.analyses.filter(
    (a) => Number(a.relevance_score ?? 0) >= 0.6,
  );

  const seen = new Set<string>();
  let unique: Record<string, unknown>[] = [];
  for (const item of qualified) {
    const url = String(item.url ?? "");
    if (url && !seen.has(url)) {
      seen.add(url);
      unique.push(item);
    }
  }

  if (iteration > 0 && feedback) {
    const prompt = `你是知识库编辑。请根据以下审核反馈定向改进条目。
反馈: ${feedback}
条目: ${JSON.stringify(unique)}

返回改进后的 JSON 数组，或 {"articles": [...]} 格式。`;

    try {
      const { parsed, usage } = await chatJson(prompt);
      tracker = accumulateUsage(tracker, usage);
      const improved = asRecordArray(parsed);
      if (improved) {
        unique = improved;
      }
    } catch {
      // 修正失败时保留当前条目
    }
  }

  const today = todayUtc();
  const articles: Record<string, unknown>[] = unique.map((item, i) => {
    const entry: Record<string, unknown> = {
      id: `${today}-${String(i + 1).padStart(3, "0")}`,
    };
    for (const key of ARTICLE_FIELDS) {
      entry[key] = item[key] ?? "";
    }
    return entry;
  });

  console.log(
    `[OrganizeNode] 整理出 ${articles.length} 条知识条目 (迭代 ${iteration})`,
  );
  return { articles, cost_tracker: tracker };
}

/** 审核节点：LLM 四维度评分，iteration >= 2 时强制通过 */
export async function reviewNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[ReviewNode] 开始质量审核");

  const articles = state.articles;
  const iteration = state.iteration;
  let tracker = { ...state.cost_tracker };

  if (articles.length === 0) {
    return {
      review_passed: true,
      review_feedback: "没有条目需要审核",
      iteration: iteration + 1,
      cost_tracker: tracker,
    };
  }

  const prompt = `你是知识库质量审核员。请审核以下条目：
${JSON.stringify(articles.slice(0, 5), null, 2)}

评分维度（1-5分）：摘要质量、标签准确性、分类合理性、整体一致性。
overall_score >= 3.5 即通过。第 ${iteration + 1} 次审核（最多 3 次）。

严格返回 JSON，不要多余文字：
{
  "passed": boolean,
  "overall_score": number,
  "feedback": string,
  "scores": {
    "summary_quality": number,
    "tag_accuracy": number,
    "category_fit": number,
    "consistency": number
  }
}`;

  let passed = false;
  let feedback = "";

  try {
    const { parsed, usage } = await chatJson(
      prompt,
      "你是严格但公正的知识库审核员。",
    );
    tracker = accumulateUsage(tracker, usage);
    passed = Boolean(parsed.passed);
    feedback = String(parsed.feedback ?? "");

    if (iteration >= 2) {
      passed = true;
      feedback += "\n[系统] 已达最大审核次数(3次)，强制通过。";
    }

    console.log(
      `[ReviewNode] 得分: ${parsed.overall_score ?? "?"}, 通过: ${passed} (迭代 ${iteration + 1}/3)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    passed = true;
    feedback = `审核失败: ${message}，自动通过`;
    console.log(`[ReviewNode] 审核异常，自动通过: ${message}`);
  }

  return {
    review_passed: passed,
    review_feedback: feedback,
    iteration: iteration + 1,
    cost_tracker: tracker,
  };
}

/** 保存节点：写入 JSON 文件并更新 index.json */
export async function saveNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[SaveNode] 开始保存文章");

  const articles = state.articles;
  if (articles.length === 0) {
    console.log("[SaveNode] 没有条目需要保存");
    return {};
  }

  mkdirSync(ARTICLES_DIR, { recursive: true });

  for (const article of articles) {
    const id = String(article.id ?? "unknown");
    const filepath = join(ARTICLES_DIR, `${id}.json`);
    writeFileSync(filepath, JSON.stringify(article, null, 2), "utf-8");
  }

  // 读取已有索引，按 id 去重后追加新条目
  let index: Record<string, unknown>[] = [];
  if (existsSync(INDEX_FILE)) {
    try {
      index = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as Record<
        string,
        unknown
      >[];
    } catch {
      index = [];
    }
  }

  const existingIds = new Set(
    index.map((entry) => String(entry.id ?? "")),
  );

  let appended = 0;
  for (const article of articles) {
    const id = String(article.id ?? "");
    if (!id || existingIds.has(id)) continue;

    index.push({
      id,
      title: article.title ?? "",
      source: article.source ?? "",
      category: article.category ?? "",
      relevance_score: article.relevance_score ?? 0,
      tags: article.tags ?? [],
      status: "published",
      collected_at: article.collected_at ?? nowUtcIso(),
    });
    existingIds.add(id);
    appended += 1;
  }

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");

  console.log(
    `[SaveNode] 保存 ${articles.length} 篇文章，索引新增 ${appended} 条`,
  );
  return {};
}
