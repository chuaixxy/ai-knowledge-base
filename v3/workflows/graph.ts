#!/usr/bin/env tsx

/**
 * LangGraph 工作流图定义 — 采集-分析-审核流水线
 *
 * 工作流拓扑:
 *   collect → analyze → organize → review ─→ save (通过)
 *                      ↑              │
 *                      └── organize (未通过，修正后重审)
 */

import { fileURLToPath } from "node:url";

import { StateGraph, START, END } from "@langchain/langgraph";

import { collectNode } from "./collector.ts";
import { analyzeNode } from "./analyzer.ts";
import { organizeNode } from "./organizer.ts";
import { reviewNode } from "./reviewer.ts";
import { saveNode } from "./nodes.ts";
import { KBStateAnnotation, type KBState } from "./state.ts";

/** 审核通过 → save，未通过 → organize 修正 */
export function shouldContinue(state: KBState): string {
  return state.review_passed ? "save" : "organize";
}

/** 构建知识库 V3 工作流图（未编译） */
export function buildGraph(): StateGraph<typeof KBStateAnnotation> {
  const graph = new StateGraph(KBStateAnnotation);

  graph.addNode("collect", collectNode);
  graph.addNode("analyze", analyzeNode);
  graph.addNode("organize", organizeNode);
  graph.addNode("review", reviewNode);
  graph.addNode("save", saveNode);

  graph.addEdge(START, "collect");
  graph.addEdge("collect", "analyze");
  graph.addEdge("analyze", "organize");
  graph.addEdge("organize", "review");

  graph.addConditionalEdges("review", shouldContinue, {
    save: "save",
    organize: "organize",
  });

  graph.addEdge("save", END);

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
    cost_tracker: {},
  };
}

/** 流式执行工作流并打印每个节点的关键输出 */
async function runCli(): Promise<void> {
  console.log("=".repeat(60));
  console.log("AI 知识库 — LangGraph 工作流启动");
  console.log("=".repeat(60));

  const initialState = createInitialState();
  const stream = await app.stream(initialState);

  for await (const event of stream) {
    const nodeName = Object.keys(event)[0];
    if (!nodeName) continue;

    const update = event[nodeName] as Partial<KBState>;
    console.log(`\n--- [${nodeName}] 完成 ---`);

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
