#!/usr/bin/env tsx

/**
 * LangGraph 工作流图定义 — 采集-分析-审核流水线（6 节点）
 *
 * 工作流拓扑:
 *   planner → collect → analyze → review ──→ organize → save → END  （通过）
 *                                     │
 *                                     ├──→ revise ──→ review         （未通过 & iter < 3，循环修正）
 *                                     │
 *                                     └──→ human_flag → END          （未通过 & iter >= 3，人工兜底）
 */

import { fileURLToPath } from "node:url";

import { StateGraph, START, END } from "@langchain/langgraph";

import { plannerNode } from "./planner.ts";
import { collectNode } from "./collector.ts";
import { analyzeNode } from "./analyzer.ts";
import { organizeNode } from "./organizer.ts";
import { reviewNode } from "./reviewer.ts";
import { reviseNode } from "./reviser.ts";
import { humanFlagNode } from "./human-flag.ts";
import { saveNode } from "./nodes.ts";
import { KBStateAnnotation, type KBState } from "./state.ts";
import { CostGuard, BudgetExceededError } from "../tests/cost-guard.ts";

/** 工作流级别预算守卫（从环境变量读取配置，默认预算 1 元，预警阈值 80%） */
export const guard = new CostGuard(
  parseFloat(process.env["BUDGET_YUAN"] ?? "1.0"),
  parseFloat(process.env["BUDGET_ALERT_THRESHOLD"] ?? "0.8"),
);

/**
 * AOP Around Advice：在节点执行前 check()，执行后从 cost_tracker 差值 record()。
 * 节点文件无需任何修改。
 */
function withCostGuard(
  nodeName: string,
  fn: (state: KBState) => Promise<Partial<KBState>>,
): (state: KBState) => Promise<Partial<KBState>> {
  return async (state: KBState) => {
    const status = guard.check();
    if (status.status === "warning") {
      console.warn(`[CostGuard] ⚠ ${status.message}`);
    }

    const result = await fn(state);

    // 从 cost_tracker 差值提取本节点实际消耗
    const prev = state.cost_tracker;
    const next = (result.cost_tracker ?? prev) as Record<string, unknown>;
    const deltaPrompt = Number(next.prompt_tokens ?? 0) - Number(prev.prompt_tokens ?? 0);
    const deltaCompletion = Number(next.completion_tokens ?? 0) - Number(prev.completion_tokens ?? 0);

    if (deltaPrompt > 0 || deltaCompletion > 0) {
      const rec = guard.record(nodeName, {
        prompt_tokens: deltaPrompt,
        completion_tokens: deltaCompletion,
      });
      console.log(
        `[CostGuard] ${nodeName}: ¥${rec.cost_yuan.toFixed(6)}，累计 ¥${guard.totalCostYuan.toFixed(6)} / ¥${parseFloat(process.env["BUDGET_YUAN"] ?? "1.0").toFixed(2)}`,
      );
    }

    return result;
  };
}

/** 审核循环最大次数。达到后路由到 human_flag，不再重试。 */
export const MAX_ITERATIONS = 3;

/**
 * 审核后三路路由：
 *   review_passed === true              → "organize"   （通过，整理入库）
 *   review_passed === false, iter < 3  → "revise"     （未通过，定向修改后重审）
 *   review_passed === false, iter >= 3 → "human_flag" （超限，人工介入）
 */
export function routeAfterReview(state: KBState): string {
  if (state.review_passed) return "organize";
  if (state.iteration >= MAX_ITERATIONS) return "human_flag";
  return "revise";
}

/** 构建知识库 V3 工作流图（未编译） */
export function buildGraph(): StateGraph<typeof KBStateAnnotation> {
  const graph = new StateGraph(KBStateAnnotation);

  graph.addNode("planner", plannerNode);
  graph.addNode("collect", collectNode);
  graph.addNode("analyze", withCostGuard("analyze", analyzeNode));
  graph.addNode("review", withCostGuard("review", reviewNode));
  graph.addNode("organize", withCostGuard("organize", organizeNode));
  graph.addNode("revise", withCostGuard("revise", reviseNode));
  graph.addNode("human_flag", humanFlagNode);
  graph.addNode("save", saveNode);

  graph.addEdge(START, "planner");
  graph.addEdge("planner", "collect");
  graph.addEdge("collect", "analyze");
  graph.addEdge("analyze", "review");

  graph.addConditionalEdges("review", routeAfterReview, {
    organize: "organize",
    revise: "revise",
    human_flag: "human_flag",
  });

  graph.addEdge("revise", "review");
  graph.addEdge("organize", "save");
  graph.addEdge("save", END);
  graph.addEdge("human_flag", END);

  return graph;
}

/** 编译后的可执行工作流 */
export const app = buildGraph().compile();

function createInitialState(): KBState {
  return {
    sources: [],
    analyses: [],
    articles: [],
    review_feedback: "",
    review_passed: false,
    iteration: 0,
    plan: {},
    cost_tracker: {},
  };
}

/** 流式执行工作流并打印每个节点的关键输出 */
async function runCli(): Promise<void> {
  console.log("=".repeat(60));
  console.log("AI 知识库 — LangGraph 工作流启动");
  console.log(`[CostGuard] 预算 ¥${parseFloat(process.env["BUDGET_YUAN"] ?? "1.0").toFixed(2)}，预警阈值 ${parseFloat(process.env["BUDGET_ALERT_THRESHOLD"] ?? "0.8") * 100}%`);
  console.log("=".repeat(60));

  const initialState = createInitialState();

  try {
    const stream = await app.stream(initialState);

    for await (const event of stream) {
      const nodeName = Object.keys(event)[0];
      if (!nodeName) continue;

      const update = event[nodeName] as Partial<KBState>;
      console.log(`\n--- [${nodeName}] 完成 ---`);

      if (update.plan && Object.keys(update.plan).length > 0) {
        console.log(`  plan: ${update.plan.tier} (target=${update.plan.target_count})`);
      }
      if (update.sources?.length !== undefined) {
        console.log(`  sources: ${update.sources.length} 条`);
      }
      if (update.analyses?.length !== undefined) {
        console.log(`  analyses: ${update.analyses.length} 条`);
      }
      if (update.articles?.length !== undefined) {
        console.log(`  articles: ${update.articles.length} 条`);
      }
      if (update.review_passed !== undefined) {
        console.log(`  review_passed: ${update.review_passed}`);
      }
      if (update.review_feedback) {
        console.log(`  review_feedback: ${update.review_feedback.slice(0, 80)}`);
      }
      if (update.iteration !== undefined) {
        console.log(`  iteration: ${update.iteration}`);
      }
      if (update.cost_tracker && Object.keys(update.cost_tracker).length > 0) {
        const tracker = update.cost_tracker;
        console.log(
          `  tokens: ${tracker.total_tokens ?? 0}, calls: ${tracker.call_count ?? 0}`,
        );
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("工作流执行完毕");
    guard.saveReport("cost-report.json");
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`\n[CostGuard] 预算超限，工作流中止`);
      console.error(`  已花费 ¥${err.totalCost.toFixed(6)} / 预算 ¥${err.budget.toFixed(6)}`);
      guard.saveReport("cost-report.json");
      process.exit(0);
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error(
      "工作流执行失败:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
