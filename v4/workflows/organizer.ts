/**
 * 整理节点 — 过滤低分、去重、按审核反馈修正，并写入 knowledge/articles/
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { filterOutput } from "../tests/security.ts";
import { chatJson, accumulateUsage, BudgetExceededError } from "./model-client.ts";
import { deriveSourceId } from "./source-id.ts";
import type { KBState } from "./state.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const ARTICLES_DIR = join(ROOT_DIR, "knowledge", "articles");
const INDEX_FILE = join(ARTICLES_DIR, "index.json");

const ARTICLE_FIELDS = [
  "title",
  "source",
  "source_id",
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

/** 写入 knowledge/articles/*.json 并更新 index.json（与 Python organizer 一致）。 */
function saveArticlesToDisk(articles: Record<string, unknown>[]): number {
  if (articles.length === 0) return 0;

  mkdirSync(ARTICLES_DIR, { recursive: true });

  for (const article of articles) {
    const id = String(article.id ?? "unknown");
    writeFileSync(
      join(ARTICLES_DIR, `${id}.json`),
      JSON.stringify(article, null, 2),
      "utf-8",
    );
  }

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

  const existingIds = new Set(index.map((entry) => String(entry.id ?? "")));
  let appended = 0;

  for (const article of articles) {
    const id = String(article.id ?? "");
    if (!id || existingIds.has(id)) continue;

    index.push({
      id,
      title: article.title ?? "",
      source: article.source ?? "",
      source_id: deriveSourceId(article),
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
  return appended;
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

function deduplicateBySourceId(
  items: Record<string, unknown>[],
): { unique: Record<string, unknown>[]; skipped: number } {
  const sessionIds = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const item of items) {
    const sourceId = deriveSourceId(item);
    if (!sourceId) continue;

    if (sessionIds.has(sourceId)) {
      console.log(`[OrganizeNode] 跳过重复（本次采集）: ${sourceId}`);
      skipped++;
      continue;
    }

    sessionIds.add(sourceId);
    unique.push({ ...item, source_id: sourceId });
  }

  return { unique, skipped };
}

export async function organizeNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[OrganizeNode] 开始整理知识条目");

  const feedback = state.review_feedback.trim();
  const iteration = state.iteration;
  let tracker = { ...state.cost_tracker };

  const plan = state.plan ?? {};
  const threshold = Number(plan.relevance_threshold ?? 0.5);
  console.log(`[OrganizeNode] 相关性门槛=${threshold}`);

  const qualified = state.analyses.filter(
    (a) => Number(a.relevance_score ?? 0) >= threshold,
  );

  let { unique, skipped } = deduplicateBySourceId(qualified);

  if (iteration > 0 && feedback) {
    const prompt = `你是知识库编辑。请根据以下审核反馈定向改进条目。
反馈: ${feedback}
条目: ${JSON.stringify(unique)}

返回改进后的 JSON 数组，或 {"articles": [...]} 格式。`;

    try {
      const { parsed, usage } = await chatJson(prompt, undefined, undefined, "organize");
      tracker = accumulateUsage(tracker, usage);
      const improved = asRecordArray(parsed);
      if (improved) {
        ({ unique, skipped } = deduplicateBySourceId(improved));
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      // 修正失败时保留当前条目
    }
  }

  const today = todayUtc();
  const articles: Record<string, unknown>[] = unique.map((item, i) => {
    const sourceId = deriveSourceId(item);
    const entry: Record<string, unknown> = {
      id: `${today}-${String(i + 1).padStart(3, "0")}`,
      source_id: sourceId,
    };
    for (const key of ARTICLE_FIELDS) {
      if (key === "source_id") continue;
      entry[key] = item[key] ?? "";
    }
    return entry;
  });

  let totalPii = 0;
  for (const article of articles) {
    for (const field of ["summary", "content", "title", "key_insight"] as const) {
      const value = article[field];
      if (typeof value !== "string") continue;

      const [filtered, detections] = filterOutput(value);
      article[field] = filtered;
      totalPii += detections.length;

      if (detections.length > 0) {
        console.log(
          `[Security] ${String(article.id ?? "?")} ${field} 掩码 PII：${detections.join(", ")}`,
        );
      }
    }
  }

  if (totalPii > 0) {
    console.log(`[Security] organize 阶段共掩码 ${totalPii} 处 PII`);
  }

  console.log(
    `[OrganizeNode] 整理出 ${articles.length} 条知识条目 (迭代 ${iteration})，跳过 ${skipped} 条本次重复`,
  );

  const appended = saveArticlesToDisk(articles);
  if (articles.length > 0) {
    console.log(
      `[OrganizeNode] 已写入 ${articles.length} 篇文章，索引新增 ${appended} 条`,
    );
    console.log(
      `[OrganizeNode] 本次运行总成本: ¥${Number(tracker.total_cost_yuan ?? 0)}`,
    );
  }

  return { articles, cost_tracker: tracker };
}
