/**
 * 整理节点 — 过滤低分、URL 去重、按审核反馈修正
 */

import { chatJson, accumulateUsage } from "./model-client.ts";
import type { KBState } from "./state.ts";

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
