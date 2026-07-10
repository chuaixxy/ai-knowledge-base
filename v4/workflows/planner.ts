/**
 * Planner — 采集策略规划节点
 *
 * 根据目标采集量（targetCount）选择三档策略（lite / standard / full），
 * 输出结构化 plan 对象供下游节点读取（如 collector、organizer、reviewer）。
 */

import type { KBState } from "./state.ts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PlanStrategy {
  /** 策略档位 */
  tier: "lite" | "standard" | "full";
  /** 实际使用的目标采集量 */
  target_count: number;
  /** 每个数据源最多采集条数 */
  per_source_limit: number;
  /** 进入 organize 的最低相关性分数 */
  relevance_threshold: number;
  /** 审核循环最大次数 */
  maxIterations: number;
  /** 策略选择理由 */
  rationale: string;
}

// ---------------------------------------------------------------------------
// 策略表
// ---------------------------------------------------------------------------

const STRATEGIES: Record<
  "lite" | "standard" | "full",
  Omit<PlanStrategy, "tier" | "target_count">
> = {
  lite: {
    per_source_limit: 5,
    relevance_threshold: 0.7,
    maxIterations: 1,
    rationale:
      "目标量较少（< 10），优先精准：提高相关性门槛、减少采集量，单轮审核即可完成，适合快速验证或调试。",
  },
  standard: {
    per_source_limit: 10,
    relevance_threshold: 0.5,
    maxIterations: 2,
    rationale:
      "目标量适中（10–19），兼顾覆盖率与质量：中等相关性门槛、最多两轮审核，是日常运行的默认档位。",
  },
  full: {
    per_source_limit: 20,
    relevance_threshold: 0.4,
    maxIterations: 3,
    rationale:
      "目标量较大（>= 20），优先覆盖：降低相关性门槛以扩大入库范围，允许三轮审核迭代提升质量，适合定期全量构建。",
  },
};

// ---------------------------------------------------------------------------
// planStrategy
// ---------------------------------------------------------------------------

/**
 * 根据目标采集量返回策略对象。
 *
 * targetCount 未传入时从环境变量 PLANNER_TARGET_COUNT 读取（默认 10）。
 */
export function planStrategy(targetCount?: number): PlanStrategy {
  const count =
    targetCount ??
    parseInt(process.env.PLANNER_TARGET_COUNT ?? "10", 10);

  const tier: "lite" | "standard" | "full" =
    count < 10 ? "lite" : count < 20 ? "standard" : "full";

  return {
    tier,
    target_count: count,
    ...STRATEGIES[tier],
  };
}

// ---------------------------------------------------------------------------
// plannerNode
// ---------------------------------------------------------------------------

/** LangGraph 节点包装：生成采集策略并写入 state.plan。 */
export async function plannerNode(
  state: KBState,
): Promise<Partial<KBState>> {
  const plan = planStrategy();

  console.log(
    `[PlannerNode] 策略档位: ${plan.tier}, 目标量: ${plan.target_count}, ` +
    `每源上限: ${plan.per_source_limit}, 相关性门槛: ${plan.relevance_threshold}, ` +
    `最大迭代: ${plan.maxIterations}`,
  );

  return { plan };
}
