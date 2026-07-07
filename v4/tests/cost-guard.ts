#!/usr/bin/env tsx

/**
 * CostGuard — 多 Agent 预算守卫
 *
 * 三重保护机制：
 *   1. record()    — 记录每次 LLM 调用的 token 用量并累计成本
 *   2. check()     — 检查预算状态，超限抛出 BudgetExceededError，逼近阈值时返回 warning
 *   3. getReport() / saveReport() — 生成/保存按节点分组的成本报告
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 单次 LLM 调用记录 */
export interface CostRecord {
  timestamp: string;
  node_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_yuan: number;
  model: string;
}

/** check() 返回值 */
export interface BudgetStatus {
  status: "ok" | "warning" | "exceeded";
  total_cost: number;
  budget: number;
  usage_ratio: number;
  message: string;
}

/** 按节点分组的统计摘要 */
export interface NodeSummary {
  call_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_yuan: number;
}

/** getReport() 返回值 */
export interface CostReport {
  generated_at: string;
  total_cost_yuan: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  call_count: number;
  budget_yuan: number;
  usage_ratio: number;
  records: CostRecord[];
  by_node: Record<string, NodeSummary>;
}

// ---------------------------------------------------------------------------
// BudgetExceededError
// ---------------------------------------------------------------------------

/** 预算超限异常 */
export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";

  constructor(
    message: string,
    readonly totalCost: number,
    readonly budget: number,
  ) {
    super(message);
    Object.setPrototypeOf(this, BudgetExceededError.prototype);
  }
}

// ---------------------------------------------------------------------------
// CostGuard
// ---------------------------------------------------------------------------

/**
 * 多 Agent 预算守卫。
 *
 * @param budgetYuan             - 总预算（元），默认 1.0
 * @param alertThreshold         - 预警阈值（0–1），默认 0.8
 * @param inputPricePerMillion   - 输入 token 单价（元/百万），默认 1.0
 * @param outputPricePerMillion  - 输出 token 单价（元/百万），默认 2.0
 */
export class CostGuard {
  private readonly _budget: number;
  private readonly _alertThreshold: number;
  private readonly _inputPrice: number;
  private readonly _outputPrice: number;

  private _records: CostRecord[] = [];
  private _totalCost = 0;
  private _totalPromptTokens = 0;
  private _totalCompletionTokens = 0;
  private _alertFired = false;

  constructor(
    budgetYuan = 1.0,
    alertThreshold = 0.8,
    inputPricePerMillion = 1.0,
    outputPricePerMillion = 2.0,
  ) {
    this._budget = budgetYuan;
    this._alertThreshold = alertThreshold;
    this._inputPrice = inputPricePerMillion;
    this._outputPrice = outputPricePerMillion;
  }

  // ---- read-only accessors (used by self-test) -----------------------------

  get totalPromptTokens(): number {
    return this._totalPromptTokens;
  }

  get totalCompletionTokens(): number {
    return this._totalCompletionTokens;
  }

  get totalCostYuan(): number {
    return this._totalCost;
  }

  // ---- record() ------------------------------------------------------------

  /**
   * 记录一次 LLM 调用的 token 用量。
   *
   * @param nodeName - 调用节点名称
   * @param usage    - { prompt_tokens, completion_tokens }
   * @param model    - 模型名称（可选）
   * @returns        本次 CostRecord
   */
  record(
    nodeName: string,
    usage: { prompt_tokens: number; completion_tokens: number },
    model = "",
  ): CostRecord {
    const costYuan =
      (usage.prompt_tokens * this._inputPrice +
        usage.completion_tokens * this._outputPrice) /
      1_000_000;

    const rec: CostRecord = {
      timestamp: new Date().toISOString(),
      node_name: nodeName,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cost_yuan: costYuan,
      model,
    };

    this._records.push(rec);
    this._totalCost += costYuan;
    this._totalPromptTokens += usage.prompt_tokens;
    this._totalCompletionTokens += usage.completion_tokens;

    return rec;
  }

  // ---- check() -------------------------------------------------------------

  /**
   * 检查预算状态。
   *
   * - total_cost >= budget              → 抛出 BudgetExceededError
   * - usage_ratio >= alertThreshold     → 返回 warning（仅触发一次）
   * - 其他                             → 返回 ok
   */
  check(): BudgetStatus {
    const usageRatio =
      this._budget > 0 ? this._totalCost / this._budget : 0;

    if (this._totalCost >= this._budget) {
      throw new BudgetExceededError(
        `预算已超限：已花费 ¥${this._totalCost.toFixed(6)}，预算 ¥${this._budget.toFixed(6)}`,
        this._totalCost,
        this._budget,
      );
    }

    if (usageRatio >= this._alertThreshold && !this._alertFired) {
      this._alertFired = true;
      return {
        status: "warning",
        total_cost: this._totalCost,
        budget: this._budget,
        usage_ratio: usageRatio,
        message: `预警：已使用 ${(usageRatio * 100).toFixed(1)}% 预算（¥${this._totalCost.toFixed(6)} / ¥${this._budget.toFixed(6)}）`,
      };
    }

    return {
      status: "ok",
      total_cost: this._totalCost,
      budget: this._budget,
      usage_ratio: usageRatio,
      message: `预算正常：已使用 ${(usageRatio * 100).toFixed(1)}%`,
    };
  }

  // ---- getReport() ---------------------------------------------------------

  /** 按节点分组生成成本报告 */
  getReport(): CostReport {
    const byNode: Record<string, NodeSummary> = {};

    for (const rec of this._records) {
      const node = rec.node_name;
      if (!byNode[node]) {
        byNode[node] = {
          call_count: 0,
          total_prompt_tokens: 0,
          total_completion_tokens: 0,
          total_cost_yuan: 0,
        };
      }
      byNode[node].call_count += 1;
      byNode[node].total_prompt_tokens += rec.prompt_tokens;
      byNode[node].total_completion_tokens += rec.completion_tokens;
      byNode[node].total_cost_yuan += rec.cost_yuan;
    }

    return {
      generated_at: new Date().toISOString(),
      total_cost_yuan: this._totalCost,
      total_prompt_tokens: this._totalPromptTokens,
      total_completion_tokens: this._totalCompletionTokens,
      call_count: this._records.length,
      budget_yuan: this._budget,
      usage_ratio: this._budget > 0 ? this._totalCost / this._budget : 0,
      records: this._records,
      by_node: byNode,
    };
  }

  // ---- saveReport() --------------------------------------------------------

  /**
   * 保存成本报告到 JSON 文件。
   *
   * @param path - 输出路径，默认 "cost-report.json"
   */
  saveReport(path = "cost-report.json"): void {
    const report = this.getReport();
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[CostGuard] 报告已保存到 ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Self-test — 等价 Python 的 if __name__ == "__main__"
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

function selfTest(): void {
  console.log("=== CostGuard 自测 ===\n");

  // ── 1. 成本追踪正确性 ──────────────────────────────────────────────────────
  console.log("1. 成本追踪正确性");

  const guard1 = new CostGuard(1.0, 0.8, 1.0, 2.0);
  guard1.record("collector", { prompt_tokens: 1_000, completion_tokens: 500 }, "deepseek-chat");
  guard1.record("analyzer", { prompt_tokens: 2_000, completion_tokens: 800 }, "deepseek-chat");

  // (1000*1 + 500*2)/1e6 + (2000*1 + 800*2)/1e6 = 2000/1e6 + 3600/1e6 = 5600/1e6
  const expectedCost = (1_000 * 1.0 + 500 * 2.0 + 2_000 * 1.0 + 800 * 2.0) / 1_000_000;

  assert(guard1.totalPromptTokens === 3_000, `totalPromptTokens 期望 3000，实际 ${guard1.totalPromptTokens}`);
  assert(guard1.totalCompletionTokens === 1_300, `totalCompletionTokens 期望 1300，实际 ${guard1.totalCompletionTokens}`);
  assert(
    Math.abs(guard1.totalCostYuan - expectedCost) < 1e-12,
    `totalCostYuan 期望 ${expectedCost}，实际 ${guard1.totalCostYuan}`,
  );

  console.log(`  totalPromptTokens    = ${guard1.totalPromptTokens} ✓`);
  console.log(`  totalCompletionTokens = ${guard1.totalCompletionTokens} ✓`);
  console.log(`  totalCostYuan        = ${guard1.totalCostYuan} (期望 ${expectedCost}) ✓`);

  // ── 2. 预算超限检测 ────────────────────────────────────────────────────────
  console.log("\n2. 预算超限检测");

  // 预算 0.001 元；记录 500k+500k tokens → 成本 1.5 元，远超预算
  const guard2 = new CostGuard(0.001, 0.8, 1.0, 2.0);
  guard2.record("heavy_node", { prompt_tokens: 500_000, completion_tokens: 500_000 });

  let threwBudgetError = false;
  try {
    guard2.check();
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      threwBudgetError = true;
      console.log(`  BudgetExceededError 捕获: "${err.message}" ✓`);
      console.log(`  err.name = "${err.name}" ✓`);
    } else {
      throw err;
    }
  }
  assert(threwBudgetError, "check() 应当抛出 BudgetExceededError");

  // ── 3. 预警阈值触发（warning，且只触发一次） ─────────────────────────────
  console.log("\n3. 预警阈值触发");

  // 预算 0.01 元，阈值 0.8 → 超过 0.008 元时触发预警
  // 记录 3000 prompt + 3000 completion:
  //   cost = (3000*1 + 3000*2)/1e6 = 9000/1e6 = 0.009 元  (ratio = 0.9 >= 0.8)
  const guard3 = new CostGuard(0.01, 0.8, 1.0, 2.0);
  guard3.record("big_node", { prompt_tokens: 3_000, completion_tokens: 3_000 });

  const status1 = guard3.check();
  assert(status1.status === "warning", `首次 check() 期望 "warning"，实际 "${status1.status}"`);
  console.log(`  首次 check() status = "${status1.status}" ✓`);
  console.log(`  message = "${status1.message}"`);

  // 再次调用 check()：预警已触发，应返回 ok
  const status2 = guard3.check();
  assert(status2.status === "ok", `二次 check() 期望 "ok"（预警不重复），实际 "${status2.status}"`);
  console.log(`  二次 check() status = "${status2.status}" （预警不重复）✓`);

  // ── 完成 ───────────────────────────────────────────────────────────────────
  console.log("\n=== 所有断言通过 ✓ ===");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
}
