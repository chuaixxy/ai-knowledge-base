/**
 * LangGraph 工作流 LLM 客户端 — 基于 pipeline/model-client，补充工作流专用能力。
 */

import {
  chat as pipelineChat,
  PROVIDER_PRICING_CNY,
} from "../pipeline/model-client.ts";
import {
  CostGuard,
  BudgetExceededError,
} from "../tests/cost-guard.ts";

export { BudgetExceededError };

let costGuardInstance: CostGuard | null = null;

export function getCostGuard(): CostGuard {
  if (!costGuardInstance) {
    const budgetYuan = parseFloat(process.env.BUDGET_YUAN ?? "1.0");
    const alertThreshold = parseFloat(process.env.BUDGET_ALERT ?? "0.8");
    costGuardInstance = new CostGuard(budgetYuan, alertThreshold);
  }
  return costGuardInstance;
}

/** 从 LLM 回复中提取 JSON 字符串（支持 markdown 代码块或裸 JSON）。 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    return text.slice(objStart, objEnd + 1);
  }

  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    return text.slice(arrStart, arrEnd + 1);
  }

  return text.trim();
}

/**
 * 调用 LLM 并返回文本与 token 用量。
 */
export async function chat(
  prompt: string,
  system?: string,
  temperature?: number,
  nodeName = "unknown",
): Promise<{ content: string; usage: Record<string, number> }> {
  const result = await pipelineChat(
    prompt,
    system ?? "你是一个 AI 技术分析助手。",
    undefined,
    undefined,
    temperature,
  );

  const guard = getCostGuard();
  guard.record(
    nodeName,
    {
      prompt_tokens: result.usage.prompt_tokens ?? 0,
      completion_tokens: result.usage.completion_tokens ?? 0,
    },
    process.env.LLM_MODEL ?? "unknown",
  );

  const checkResult = guard.check();
  if (checkResult.status === "warning") {
    console.warn(`[CostGuard] ${checkResult.message}`);
  }

  return result;
}

/**
 * 调用 LLM 并解析 JSON 回复（根节点可为对象或数组）。
 */
export async function chatJson(
  prompt: string,
  system?: string,
  temperature?: number,
  nodeName = "unknown",
): Promise<{ parsed: Record<string, unknown>; usage: Record<string, number> }> {
  const { content, usage } = await chat(prompt, system, temperature, nodeName);
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  return { parsed, usage };
}

/**
 * 累加 token 统计到 cost_tracker，返回更新后的 tracker。
 */
export function accumulateUsage(
  tracker: Record<string, unknown>,
  usage: Record<string, number>,
): Record<string, unknown> {
  const promptTokens =
    Number(tracker.prompt_tokens ?? 0) + (usage.prompt_tokens ?? 0);
  const completionTokens =
    Number(tracker.completion_tokens ?? 0) + (usage.completion_tokens ?? 0);
  const totalTokens =
    Number(tracker.total_tokens ?? 0) + (usage.total_tokens ?? 0);
  const callCount = Number(tracker.call_count ?? 0) + 1;

  const providerKey = (process.env.LLM_PROVIDER || "deepseek").toLowerCase();
  const pricing =
    PROVIDER_PRICING_CNY[providerKey] ?? PROVIDER_PRICING_CNY["deepseek"]!;
  const incrementalCost =
    ((usage.prompt_tokens ?? 0) * pricing.input +
      (usage.completion_tokens ?? 0) * pricing.output) /
    1_000_000;
  const prevCost = Number(tracker.total_cost_yuan ?? 0);

  return {
    ...tracker,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    call_count: callCount,
    total_cost_yuan: prevCost + incrementalCost,
  };
}
