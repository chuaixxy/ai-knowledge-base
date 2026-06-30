/**
 * 分析节点 — 用 LLM 对每条原始数据生成中文摘要、标签、评分
 */

import { chatJson, accumulateUsage } from "./model-client.ts";
import type { KBState } from "./state.ts";

function isErrorItem(item: Record<string, unknown>): boolean {
  return String(item.title ?? "").startsWith("[ERROR]");
}

export async function analyzeNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[AnalyzeNode] 开始 LLM 分析");

  const analyses: Record<string, unknown>[] = [];
  let tracker = { ...state.cost_tracker };

  for (const item of state.sources) {
    if (isErrorItem(item)) continue;

    const prompt = `请分析以下技术项目，用 JSON 格式返回：
项目名: ${item.title}
描述: ${item.description ?? "无描述"}

返回格式: {"summary": "200字中文摘要", "tags": ["标签"], "relevance_score": 0.8, "category": "分类", "key_insight": "一句话洞察"}`;

    try {
      const { parsed, usage } = await chatJson(prompt);
      tracker = accumulateUsage(tracker, usage);
      analyses.push({ ...item, ...parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[AnalyzeNode] 分析失败: ${item.title} - ${message}`);
      analyses.push({
        ...item,
        summary: `分析失败: ${message}`,
        relevance_score: 0.0,
      });
    }
  }

  console.log(`[AnalyzeNode] 完成 ${analyses.length} 条分析`);
  return { analyses, cost_tracker: tracker };
}
