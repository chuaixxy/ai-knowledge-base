#!/usr/bin/env tsx

/**
 * Supervisor 监督模式示例。
 *
 * Worker Agent 输出 JSON 分析报告，Supervisor Agent 对其进行质量审核，
 * 不通过则带反馈重做，最多循环 maxRetries 轮。
 *
 * 用法：
 *   tsx patterns/supervisor.ts
 *   tsx patterns/supervisor.ts "分析 RAG 技术的核心优势与局限性"
 */

import { fileURLToPath } from "node:url";
import { chat } from "../pipeline/model-client.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Worker 输出的分析报告。 */
interface WorkerReport {
  summary: string;
  key_points: string[];
  conclusion: string;
}

/** Supervisor 审核结果。 */
interface ReviewResult {
  passed: boolean;
  score: number;
  accuracy: number;
  depth: number;
  format: number;
  feedback: string;
}

/** supervisor() 函数的返回值。 */
export interface SupervisorResult {
  /** Worker 最终输出（JSON 字符串）。 */
  output: string;
  /** 实际执行轮数（1 起步）。 */
  attempts: number;
  /** 最终得分（1–10）。 */
  final_score: number;
  /** 超过最大重试次数时附带警告。 */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 从 LLM 输出中提取 JSON 块。
 * 兼容 ```json ... ``` 代码块和裸 JSON 两种格式。
 */
function extractJson(text: string): string {
  // 优先提取 ```json ... ``` 块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // 次选：提取第一个完整的 { ... } 对象
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text.trim();
}

// ---------------------------------------------------------------------------
// Worker Agent
// ---------------------------------------------------------------------------

const WORKER_SYSTEM = `你是一个专业的技术分析助手。
接收用户任务后，输出一份结构化的 JSON 分析报告，格式严格如下：

{
  "summary": "一句话总结（不超过 50 字）",
  "key_points": ["要点1", "要点2", "要点3"],
  "conclusion": "结论段落（100-200 字，有深度，有具体论据）"
}

要求：
- 只输出 JSON，不要任何额外文字
- key_points 至少 3 条，每条不超过 30 字
- conclusion 必须包含具体论据或数据支撑`;

/**
 * Worker Agent：接收任务（及可选的上轮反馈），输出 JSON 分析报告。
 *
 * @param task     原始任务描述
 * @param feedback 上轮 Supervisor 的改进反馈（重做时传入）
 */
async function runWorker(task: string, feedback?: string): Promise<string> {
  const prompt = feedback
    ? `任务：${task}\n\n上一版报告的改进意见（请针对性修改）：\n${feedback}`
    : `任务：${task}`;

  const { content } = await chat(prompt, WORKER_SYSTEM);
  return extractJson(content);
}

// ---------------------------------------------------------------------------
// Supervisor Agent
// ---------------------------------------------------------------------------

const SUPERVISOR_SYSTEM = `你是一个严格的质量审核员，负责评审 AI 生成的技术分析报告。

评分标准（每项 1–10 分）：
- accuracy（准确性）：事实是否正确，有无明显错误
- depth（深度）：是否有洞察力，是否有具体论据，而非泛泛而谈
- format（格式）：JSON 格式是否合规，字段是否完整

综合得分 score = (accuracy + depth + format) / 3，保留一位小数。

输出严格 JSON，不要任何额外文字：
{
  "passed": <score >= 7 时为 true>,
  "score": <综合得分，数字>,
  "accuracy": <准确性分，数字>,
  "depth": <深度分，数字>,
  "format": <格式分，数字>,
  "feedback": "<不通过时给出具体改进建议；通过时写'质量达标'"
}`;

/**
 * Supervisor Agent：审核 Worker 输出，返回结构化评审结果。
 *
 * @param task         原始任务（提供上下文）
 * @param workerOutput Worker 的 JSON 输出
 */
async function runSupervisor(task: string, workerOutput: string): Promise<ReviewResult> {
  const prompt = `原始任务：${task}\n\nWorker 输出：\n${workerOutput}`;
  const { content } = await chat(prompt, SUPERVISOR_SYSTEM, undefined, 3, 0.2);

  let parsed: ReviewResult;
  try {
    parsed = JSON.parse(extractJson(content)) as ReviewResult;
  } catch {
    // LLM 输出无法解析时，给一个低分兜底，触发重试
    console.error("[Supervisor] 审核结果解析失败，原始输出:", content.slice(0, 200));
    return {
      passed: false,
      score: 1,
      accuracy: 1,
      depth: 1,
      format: 1,
      feedback: "审核结果格式错误，请重新生成更规范的 JSON 报告。",
    };
  }

  // 修正 passed 字段，以 score 为准（防止 LLM 判断不一致）
  parsed.passed = parsed.score >= 7;
  return parsed;
}

// ---------------------------------------------------------------------------
// Supervisor 主流程
// ---------------------------------------------------------------------------

/**
 * Supervisor 监督循环。
 *
 * 1. Worker 生成报告
 * 2. Supervisor 审核
 * 3. 通过（score >= 7）→ 返回
 * 4. 不通过且未超限 → 带反馈重做
 * 5. 超过 maxRetries → 强制返回 + warning
 *
 * @param task       任务描述
 * @param maxRetries 最大重试轮数（默认 3）
 */
export async function supervisor(
  task: string,
  maxRetries: number = 3,
): Promise<SupervisorResult> {
  let attempts = 0;
  let lastOutput = "";
  let lastReview: ReviewResult | null = null;
  let feedback: string | undefined;

  while (attempts < maxRetries) {
    attempts++;
    console.error(`\n[Supervisor] === 第 ${attempts}/${maxRetries} 轮 ===`);

    // Step 1: Worker 生成报告
    console.error(`[Supervisor] Worker 生成报告...`);
    lastOutput = await runWorker(task, feedback);
    console.error(`[Supervisor] Worker 输出: ${lastOutput.slice(0, 100)}...`);

    // Step 2: Supervisor 审核
    console.error(`[Supervisor] Supervisor 审核中...`);
    lastReview = await runSupervisor(task, lastOutput);
    console.error(
      `[Supervisor] 审核结果: score=${lastReview.score} ` +
      `(准确性=${lastReview.accuracy} 深度=${lastReview.depth} 格式=${lastReview.format}) ` +
      `passed=${lastReview.passed}`,
    );

    if (lastReview.passed) {
      console.error(`[Supervisor] 质量达标，退出循环。`);
      return {
        output: lastOutput,
        attempts,
        final_score: lastReview.score,
      };
    }

    // 不通过：记录反馈，下一轮带入
    feedback = lastReview.feedback;
    console.error(`[Supervisor] 未通过，反馈: ${feedback}`);
  }

  // 超过最大轮数，强制返回
  const warning = `超过最大重试次数（${maxRetries} 轮），强制返回最后一次结果（score=${lastReview?.score ?? "N/A"}）`;
  console.error(`[Supervisor] ⚠ ${warning}`);

  return {
    output: lastOutput,
    attempts,
    final_score: lastReview?.score ?? 0,
    warning,
  };
}

// ---------------------------------------------------------------------------
// CLI test entry
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const task =
    process.argv[2] ||
    "分析大型语言模型（LLM）在实际生产环境中面临的主要挑战";

  console.log(`\n任务：${task}`);
  console.log("=".repeat(60));

  supervisor(task)
    .then((result) => {
      console.log("\n" + "=".repeat(60));
      console.log(`执行轮数：${result.attempts}`);
      console.log(`最终得分：${result.final_score}`);
      if (result.warning) {
        console.log(`⚠  警告：${result.warning}`);
      }
      console.log("\n--- Worker 最终输出 ---");

      // 尝试美化打印 JSON
      try {
        const parsed = JSON.parse(result.output) as WorkerReport;
        console.log(`摘要：${parsed.summary}`);
        console.log(`要点：`);
        for (const point of parsed.key_points) {
          console.log(`  • ${point}`);
        }
        console.log(`结论：${parsed.conclusion}`);
      } catch {
        console.log(result.output);
      }
    })
    .catch((err) => {
      console.error("执行失败:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
