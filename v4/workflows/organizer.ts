/**
 * 整理节点 — 过滤低分、当次 source_id 去重、按审核反馈修正
 */

import { filterOutput } from "../tests/security.ts";
import { chatJson, accumulateUsage, BudgetExceededError } from "./model-client.ts";
import { deriveSourceId } from "./source-id.ts";
import type { KBState } from "./state.ts";

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
  return { articles, cost_tracker: tracker };
}
