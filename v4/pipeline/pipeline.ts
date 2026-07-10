#!/usr/bin/env tsx

/**
 * pipeline/pipeline.ts — V4 知识库采集分析流水线
 *
 * 【V4 的关键演进：继承 V3 的 LangGraph 工作流】
 *
 * V1 (Week1) → 手动 Agent + OpenCode
 * V2 (Week2) → 自动化四步流水线 (关键词匹配)
 * V3 (Week3) → LangGraph + Planner/Reviewer + 审核循环 (真 LLM)
 * V4 (Week4) → V3 LangGraph 的基础上 + 分发层 (formatter/publisher) + 容器化
 *
 * 本文件是 V3 LangGraph `workflows/graph.ts` 的**薄封装** ——
 * 在流水线跑完后追加一步：分发 (publish)。
 *
 * 调用关系:
 *   workflows/graph.buildGraph().compile().stream(state)  ← 核心 Review Loop
 *           │
 *           ▼
 *   distribution/publisher.publishDailyDigest()  ← V4 新增
 *
 * 用法:
 *   npx tsx pipeline/pipeline.ts
 *   npx tsx pipeline/pipeline.ts --no-publish
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";

import { publishDailyDigest } from "../distribution/publisher.ts";
import {
  buildGraph,
  printCostReport,
  BudgetExceededError,
} from "../workflows/graph.ts";
import type { KBState } from "../workflows/state.ts";

config();

function createInitialState(): KBState {
  return {
    plan: {},
    sources: [],
    analyses: [],
    articles: [],
    review_feedback: "",
    review_passed: false,
    iteration: 0,
    needsHumanReview: false,
    cost_tracker: {},
  };
}

/**
 * 运行完整的 V4 流水线。
 *
 * 阶段:
 * 1. V3 LangGraph 工作流 (plan → collect → analyze → review → organize)
 * 2. V4 新增：发布每日简报到各渠道 (Feishu / File)
 *
 * @param publish - 是否在流水线完成后发布每日简报
 * @returns 本次运行生成/更新的知识条目列表
 */
export async function runPipeline(
  publish = true,
): Promise<Record<string, unknown>[]> {
  const startedAt = new Date().toISOString();

  console.log("=".repeat(60));
  console.log(`[V4 Pipeline] 开始执行 — ${startedAt}`);
  console.log("=".repeat(60));

  // ------ Stage A: 运行 V3 LangGraph 工作流 ------
  console.log("[V4 Pipeline] Stage A: V3 LangGraph 工作流");

  const app = buildGraph().compile();
  const initialState = createInitialState();

  const finalState: Partial<KBState> = {};
  let currentPlan: Record<string, unknown> = {};

  try {
    const stream = await app.stream(initialState);

    for await (const event of stream) {
      const nodeName = Object.keys(event)[0];
      if (!nodeName) continue;

      const nodeOutput = event[nodeName] as Partial<KBState>;
      Object.assign(finalState, nodeOutput);

      if (nodeOutput.plan && Object.keys(nodeOutput.plan).length > 0) {
        currentPlan = nodeOutput.plan;
        console.log(
          `[Pipeline] plan 策略: ${String(currentPlan.strategy ?? currentPlan.tier ?? "?")}`,
        );
      }
      if (nodeOutput.sources !== undefined) {
        console.log(`[Pipeline] collect: ${nodeOutput.sources.length} 条`);
      }
      if (nodeOutput.analyses !== undefined) {
        console.log(`[Pipeline] analyze: ${nodeOutput.analyses.length} 条`);
      }
      if (nodeOutput.articles !== undefined) {
        console.log(`[Pipeline] organize: ${nodeOutput.articles.length} 条`);
      }
      if (nodeOutput.review_passed !== undefined) {
        const maxIter = Number(currentPlan.maxIterations ?? 3);
        const passed = nodeOutput.review_passed ? "通过" : "未通过";
        console.log(
          `[Pipeline] review: ${passed} (${nodeOutput.iteration ?? "?"} / ${maxIter})`,
        );
      }
      if (nodeOutput.needsHumanReview) {
        console.log("[Pipeline] ⚠️ 需要人工介入");
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`[V4 Pipeline] 预算熔断触发：${err.message}`);
    } else {
      throw err;
    }
  } finally {
    printCostReport();
  }

  const articles = finalState.articles ?? [];
  const cost = Number(finalState.cost_tracker?.total_cost_yuan ?? 0);
  console.log(
    `[V4 Pipeline] Stage A 完成：${articles.length} 条文章，成本 ¥${cost}`,
  );

  // ------ Stage B: V4 新增 — 分发每日简报 ------
  if (publish && articles.length > 0) {
    console.log("[V4 Pipeline] Stage B: 发布每日简报");
    try {
      const results = await publishDailyDigest();
      for (const r of results) {
        const status = r.success ? "成功" : `失败(${r.error ?? "unknown"})`;
        console.log(`[V4 Pipeline] ${r.channel}: ${status}`);
      }
    } catch (err) {
      console.error(
        `[V4 Pipeline] 发布失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (!publish) {
    console.log("[V4 Pipeline] 跳过发布（--no-publish）");
  } else {
    console.log("[V4 Pipeline] 无新文章，跳过发布");
  }

  console.log("=".repeat(60));
  console.log(`[V4 Pipeline] 完成 — 总成本 ¥${cost}`);
  console.log("=".repeat(60));

  return articles;
}

// ============================================================
// CLI 入口
// ============================================================

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const publish = !process.argv.includes("--no-publish");

  runPipeline(publish).catch((err) => {
    console.error(
      "[V4 Pipeline] 执行失败:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
