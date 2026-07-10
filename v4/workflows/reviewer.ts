/**
 * 审核节点 — 5 维度加权评分质量门控
 *
 * 审核对象: state.analyses（analyzeNode 产出，organizeNode 之前执行）
 * 评分维度与权重:
 *   summary_quality  25%
 *   technical_depth  25%
 *   relevance        20%
 *   originality      15%
 *   formatting       15%
 *
 * 加权总分 >= 7.0 通过；LLM 调用失败时自动通过，不阻塞流程。
 */

import { chatJson, accumulateUsage, BudgetExceededError } from "./model-client.ts";
import type { KBState } from "./state.ts";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const REVIEWER_WEIGHTS: Record<string, number> = {
  summary_quality: 0.25,
  technical_depth: 0.25,
  relevance: 0.20,
  originality: 0.15,
  formatting: 0.15,
};

export const REVIEWER_PASS_THRESHOLD = 7.0;

const REVIEWER_SYSTEM =
  "你是严格但公正的知识库质量审核员。给出具体、可操作的反馈。";

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

/**
 * 审核节点：对 state.analyses 前 5 条进行 5 维度 LLM 评分，
 * 代码重算加权总分，不信任模型算术。
 */
export async function reviewNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[ReviewNode] 开始质量审核");

  const { analyses, iteration, cost_tracker } = state;
  const plan = state.plan ?? {};
  const maxIterations = Number(plan.maxIterations ?? 3);
  let tracker = { ...cost_tracker };

  // 空样本：直接通过
  if (analyses.length === 0) {
    return {
      review_passed: true,
      review_feedback: "没有条目需要审核",
      iteration: iteration + 1,
      cost_tracker: tracker,
    };
  }

  const sample = analyses.slice(0, 5);

  const prompt = `请审核以下知识库条目（共 ${sample.length} 条），第 ${iteration + 1} 次审核：
${JSON.stringify(sample, null, 2)}

对以下 5 个维度逐一打分（1–10 分）：
- summary_quality（摘要质量）
- technical_depth（技术深度）
- relevance（相关性）
- originality（原创性）
- formatting（格式规范）

严格返回 JSON，不要多余文字：
{
  "scores": {
    "summary_quality": number,
    "technical_depth": number,
    "relevance": number,
    "originality": number,
    "formatting": number
  },
  "feedback": string,
  "weak_dimensions": string[]
}`;

  let passed = false;
  let feedback = "";

  try {
    const { parsed, usage } = await chatJson(prompt, REVIEWER_SYSTEM, 0.1, "review");
    tracker = accumulateUsage(tracker, usage);

    // 代码重算加权总分，不使用 LLM 返回的 passed / overall_score
    const scores = (parsed.scores ?? {}) as Record<string, unknown>;
    const weightedTotal =
      Math.round(
        Object.entries(REVIEWER_WEIGHTS).reduce(
          (sum, [dim, weight]) => sum + Number(scores[dim] ?? 0) * weight,
          0,
        ) * 100,
      ) / 100;

    passed = weightedTotal >= REVIEWER_PASS_THRESHOLD;

    const weakDimensions = Array.isArray(parsed.weak_dimensions)
      ? (parsed.weak_dimensions as string[])
      : [];
    const rawFeedback = String(parsed.feedback ?? "");
    feedback =
      weakDimensions.length > 0
        ? `[弱项: ${weakDimensions.join(", ")}] ${rawFeedback}`
        : rawFeedback;

    console.log(
      `[ReviewNode] 加权总分: ${weightedTotal}/10, 通过: ${passed} (第 ${iteration + 1}/${maxIterations} 次审核)`,
    );
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    passed = true;
    feedback = `审核 LLM 调用失败: ${message}，自动通过`;
    console.log(`[ReviewNode] 审核异常，自动通过: ${message}`);
  }

  return {
    review_passed: passed,
    review_feedback: feedback,
    iteration: iteration + 1,
    cost_tracker: tracker,
  };
}
