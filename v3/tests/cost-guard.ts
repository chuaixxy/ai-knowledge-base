/**
 * CostGuard — 多 Agent 预算守卫
 *
 * 三重保护：成本追踪 (record) + 预警提醒 + 预算熔断 (BudgetExceededError)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 类型与异常 ───────────────────────────────────────────────

export interface CostRecord {
  timestamp: number;
  node_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_yuan: number;
  model: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface BudgetCheckResult {
  status: "ok" | "warning";
  total_cost: number;
  budget: number;
  usage_ratio: number;
  message: string;
}

export interface CostReport {
  total_cost_yuan: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_calls: number;
  budget_yuan: number;
  cost_by_node: Record<string, number>;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";

  constructor(message: string) {
    super(message);
  }
}

// ── CostGuard ─────────────────────────────────────────────────

export class CostGuard {
  readonly budgetYuan: number;
  readonly alertThreshold: number;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;

  readonly records: CostRecord[] = [];
  totalPromptTokens = 0;
  totalCompletionTokens = 0;
  totalCostYuan = 0;

  private _alertFired = false;

  constructor(
    budgetYuan = 1.0,
    alertThreshold = 0.8,
    inputPricePerMillion = 1.0,
    outputPricePerMillion = 2.0,
  ) {
    this.budgetYuan = budgetYuan;
    this.alertThreshold = alertThreshold;
    this.inputPricePerMillion = inputPricePerMillion;
    this.outputPricePerMillion = outputPricePerMillion;
  }

  record(
    nodeName: string,
    usage: TokenUsage,
    model = "",
  ): CostRecord {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const costYuan =
      (promptTokens * this.inputPricePerMillion +
        completionTokens * this.outputPricePerMillion) /
      1_000_000;

    const rec: CostRecord = {
      timestamp: Date.now() / 1000,
      node_name: nodeName,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_yuan: costYuan,
      model,
    };

    this.records.push(rec);
    this.totalPromptTokens += promptTokens;
    this.totalCompletionTokens += completionTokens;
    this.totalCostYuan += costYuan;

    return rec;
  }

  check(): BudgetCheckResult {
    const usageRatio =
      this.budgetYuan > 0 ? this.totalCostYuan / this.budgetYuan : 0;

    if (this.totalCostYuan >= this.budgetYuan) {
      throw new BudgetExceededError(
        `成本已超出预算！当前: ¥${this.totalCostYuan.toFixed(4)}, 预算: ¥${this.budgetYuan.toFixed(2)}`,
      );
    }

    if (usageRatio >= this.alertThreshold && !this._alertFired) {
      this._alertFired = true;
      return {
        status: "warning",
        total_cost: round6(this.totalCostYuan),
        budget: this.budgetYuan,
        usage_ratio: round4(usageRatio),
        message: `[预警] 成本已达预算的 ${Math.round(usageRatio * 100)}%！`,
      };
    }

    return {
      status: "ok",
      total_cost: round6(this.totalCostYuan),
      budget: this.budgetYuan,
      usage_ratio: round4(usageRatio),
      message: `成本正常: ¥${this.totalCostYuan.toFixed(4)} / ¥${this.budgetYuan.toFixed(2)}`,
    };
  }

  getReport(): CostReport {
    const costByNode: Record<string, number> = {};

    for (const rec of this.records) {
      costByNode[rec.node_name] =
        (costByNode[rec.node_name] ?? 0) + rec.cost_yuan;
    }

    return {
      total_cost_yuan: round6(this.totalCostYuan),
      total_prompt_tokens: this.totalPromptTokens,
      total_completion_tokens: this.totalCompletionTokens,
      total_calls: this.records.length,
      budget_yuan: this.budgetYuan,
      cost_by_node: Object.fromEntries(
        Object.entries(costByNode).map(([node, cost]) => [node, round6(cost)]),
      ),
    };
  }

  saveReport(path = "cost-report.json"): string {
    const filePath = resolve(path);
    writeFileSync(filePath, JSON.stringify(this.getReport(), null, 2), "utf-8");
    return filePath;
  }
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ── 自测入口（tsx tests/cost-guard.ts）──────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  console.log("=== 测试 1：成本追踪 ===");
  const guard = new CostGuard(1.0);
  guard.record("collect", { prompt_tokens: 100, completion_tokens: 50 });
  guard.record("analyze", { prompt_tokens: 2000, completion_tokens: 1000 });
  guard.record("review", { prompt_tokens: 2500, completion_tokens: 800 });

  const report = guard.getReport();
  console.log(`  调用次数: ${report.total_calls}`);
  console.log(`  总成本: ¥${report.total_cost_yuan}`);
  console.log(`  按节点: ${JSON.stringify(report.cost_by_node)}`);

  if (guard.totalPromptTokens !== 4600) {
    throw new Error(`totalPromptTokens 应为 4600，实际 ${guard.totalPromptTokens}`);
  }
  if (guard.totalCompletionTokens !== 1850) {
    throw new Error(
      `totalCompletionTokens 应为 1850，实际 ${guard.totalCompletionTokens}`,
    );
  }
  if (report.total_cost_yuan !== 0.0083) {
    throw new Error(`total_cost_yuan 应为 0.0083，实际 ${report.total_cost_yuan}`);
  }

  const result = guard.check();
  console.log(`  预算状态: ${result.status}\n`);

  console.log("=== 测试 2：预算超限 ===");
  const guard2 = new CostGuard(0.001);
  guard2.record("analyze", {
    prompt_tokens: 100_000,
    completion_tokens: 100_000,
  });

  try {
    guard2.check();
    throw new Error("应该抛出 BudgetExceededError！");
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err;
    console.log(`  预算超限检测通过: ${err.message}\n`);
  }

  console.log("=== 测试 3：预警阈值 ===");
  const guard3 = new CostGuard(0.01, 0.5);
  guard3.record("analyze", { prompt_tokens: 5000, completion_tokens: 2000 });
  const result3 = guard3.check();
  console.log(`  预警状态: ${result3.status} — ${result3.message}\n`);

  if (result3.status !== "warning") {
    throw new Error(`预警状态应为 warning，实际 ${result3.status}`);
  }

  console.log("所有测试通过！");
}
