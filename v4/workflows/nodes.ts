/**
 * 工作流节点统一出口
 *
 * 各节点已拆分为独立文件：
 *   planner.ts    — plannerNode
 *   collector.ts  — collectNode
 *   analyzer.ts   — analyzeNode
 *   organizer.ts  — organizeNode（含写盘）
 *   reviewer.ts   — reviewNode
 *   reviser.ts    — reviseNode
 *   human-flag.ts — humanFlagNode
 *
 * 本文件保留 reviewNodeTest，并重新导出所有节点，供外部代码通过单一入口引用。
 */

import type { KBState } from "./state.ts";

export { plannerNode, planStrategy, type PlanStrategy } from "./planner.ts";
export { collectNode } from "./collector.ts";
export { analyzeNode } from "./analyzer.ts";
export { organizeNode } from "./organizer.ts";
export { reviewNode, REVIEWER_WEIGHTS, REVIEWER_PASS_THRESHOLD } from "./reviewer.ts";
export { reviseNode } from "./reviser.ts";
export { humanFlagNode } from "./human-flag.ts";

/**
 * 测试用审核节点：前 2 次不通过，第 3 次通过（不调用 LLM）。
 * 验证审核循环后请改回 reviewNode。
 */
export async function reviewNodeTest(
  state: KBState,
): Promise<Partial<KBState>> {
  const iteration = state.iteration;
  const nextIteration = iteration + 1;

  const feedbacks = [
    "摘要过于简略，请补充技术细节和适用场景说明。",
    "标签数量不足且分类不准确，请重新标注并调整 category。",
    "条目质量已达标，格式与内容一致性良好，准予通过。",
  ];

  const passed = iteration >= 2;
  const feedback = feedbacks[Math.min(iteration, feedbacks.length - 1)];

  console.log(
    `[Reviewer-Test] iteration=${nextIteration}, review_passed=${passed}`,
  );
  console.log(`[Reviewer-Test] feedback: ${feedback}`);

  return {
    review_passed: passed,
    review_feedback: feedback,
    iteration: nextIteration,
  };
}
