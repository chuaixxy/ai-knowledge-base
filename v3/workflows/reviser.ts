/**
 * Reviser Agent — 定向修改节点（只修改不评估）
 *
 * 接收 Reviewer 的反馈，对 state.analyses 做定向改写。
 * 与 reviewer.ts 职责分离：Reviewer 评估质量，Reviser 执行修改，避免自评自改。
 */

import { chatJson, accumulateUsage, BudgetExceededError } from "./model-client.ts";
import type { KBState } from "./state.ts";

const REVISER_SYSTEM =
  "你是经验丰富的知识库编辑。根据反馈定向修改，不要过度发散。";

/** LLM 可能直接返回 JSON 数组，或 {"analyses": [...]} 包装形式。 */
function asRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value as Record<string, unknown>[];
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).analyses)
  ) {
    return (value as Record<string, unknown>).analyses as Record<
      string,
      unknown
    >[];
  }
  return null;
}

export async function reviseNode(
  state: KBState,
): Promise<Partial<KBState>> {
  const { analyses, review_feedback, iteration, cost_tracker } = state;
  const feedback = review_feedback.trim();
  let tracker = { ...cost_tracker };

  if (analyses.length === 0 || !feedback) {
    console.log("[ReviseNode] 无可修改内容，跳过");
    return {};
  }

  const prompt = `你是知识库编辑。以下是审核员的反馈，请据此修改这些分析结果。

【审核反馈】
${feedback}

【当前分析结果】
${JSON.stringify(analyses, null, 2)}

【修改要求】
- 重点改进反馈中提到的弱项维度
- 保留已经不错的部分
- 保持相同字段结构（如 summary, tags, relevance_score, category, key_insight 等）
- 返回修改后的 JSON 数组`;

  try {
    const { parsed, usage } = await chatJson(prompt, REVISER_SYSTEM, 0.4, "revise");
    tracker = accumulateUsage(tracker, usage);

    const improved = asRecordArray(parsed);
    if (improved && improved.length > 0) {
      console.log(
        `[ReviseNode] 定向修改 ${improved.length} 条 analyses (迭代 ${iteration})`,
      );
      return { analyses: improved, cost_tracker: tracker };
    }

    console.log("[ReviseNode] LLM 返回结果无法解析为数组，保留原 analyses");
    return { cost_tracker: tracker };
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[ReviseNode] 修改失败: ${message}，保留原 analyses`);
    return { cost_tracker: tracker };
  }
}
