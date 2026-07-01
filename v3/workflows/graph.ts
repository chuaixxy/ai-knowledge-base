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
 *
 * CostGuard 集成：model-client.chat 每次 LLM 调用后 record + check；
 * 本文件仅在 runCli 收尾打印成本报告。
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
import { getCostGuard, BudgetExceededError } from "./model-client.ts";

export { BudgetExceededError };

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
  graph.addNode("analyze", analyzeNode);
  graph.addNode("review", reviewNode);
  graph.addNode("organize", organizeNode);
  graph.addNode("revise", reviseNode);
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

/** 打印 CostGuard 成本报告并落盘 */
export function printCostReport(reportPath = "knowledge/cost-report.json"): void {
  const guard = getCostGuard();
  const report = guard.getReport();

  console.log(
    `\n[CostGuard] 总调用 ${report.call_count} 次 · 总成本 ¥${report.total_cost_yuan}`,
  );
  console.log(`[CostGuard] 按节点：${JSON.stringify(report.by_node)}`);

  guard.saveReport(reportPath);
}

/** 流式执行工作流并打印每个节点的关键输出 */
async function runCli(): Promise<void> {
  console.log("=".repeat(60));
  console.log("AI 知识库 — LangGraph 工作流启动");
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

    console.log("\n=== 工作流完成 ===");
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`\n[FATAL] 预算熔断触发：${err.message}`);
    } else {
      throw err;
    }
  } finally {
    printCostReport();
  }

  console.log("\n" + "=".repeat(60));
  console.log("工作流执行完毕");
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
