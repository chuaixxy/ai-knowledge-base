/**
 * Eval 评估测试 — AI 知识库质量验证
 *
 * 核心原则：
 * - 不测精确内容，测行为边界
 * - 用 >=, <=, includes 代替 ==
 * - 正面 + 负面 + 边界 = 最小 Eval 集
 * - LLM-as-Judge 做质量评分
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";
import { chat } from "../workflows/model-client.ts";

const v3Root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(v3Root, ".env") });

// ── 类型与用例定义 ──────────────────────────────────────────

interface EvalCase {
  name: string;
  input: string;
  expected: Record<string, unknown>;
}

const EVAL_CASES: EvalCase[] = [
  {
    name: "正面案例 — 技术项目分析",
    input:
      "LangGraph 是一个基于有向图的多 Agent 工作流编排框架，支持条件分支和循环。",
    expected: {
      min_length: 50,
      max_length: 1000,
      must_contain_any: ["LangGraph", "工作流", "Agent", "图"],
    },
  },
  {
    name: "负面案例 — 无关内容",
    input: "今天天气真好，适合出去野餐，带上三明治和果汁。",
    expected: { max_length: 500, should_mention_irrelevant: true },
  },
  {
    name: "边界案例 — 极短输入",
    input: "AI",
    expected: { min_length: 1, no_crash: true },
  },
  {
    name: "正面案例 — 英文技术内容",
    input:
      "OpenAI released GPT-5 with 1M token context window and native tool use.",
    expected: {
      min_length: 30,
      must_contain_any: ["GPT-5", "OpenAI", "token", "context"],
    },
  },
];

const IRRELEVANT_KEYWORDS = [
  "不相关",
  "无关",
  "不是",
  "非技术",
  "irrelevant",
  "not related",
  "unrelated",
];

// ── 辅助函数 ────────────────────────────────────────────────

function assertEvalResult(result: string, expected: Record<string, unknown>): void {
  if (typeof expected.min_length === "number") {
    expect(result.length).toBeGreaterThanOrEqual(expected.min_length);
  }
  if (typeof expected.max_length === "number") {
    expect(result.length).toBeLessThanOrEqual(expected.max_length);
  }
  if (Array.isArray(expected.must_contain_any)) {
    const keywords = expected.must_contain_any as string[];
    const found = keywords.some((kw) => result.includes(kw));
    expect(found).toBe(true);
  }
  if (expected.should_mention_irrelevant === true) {
    const mentionsIrrelevant = IRRELEVANT_KEYWORDS.some((kw) =>
      result.toLowerCase().includes(kw.toLowerCase()),
    );
    expect(mentionsIrrelevant).toBe(true);
  }
}

function parseJudgeScore(scoreText: string): number {
  const trimmed = scoreText.trim();
  const parsed = parseInt(trimmed, 10);
  if (!Number.isNaN(parsed)) return parsed;

  const match = trimmed.match(/\d+/);
  return match ? parseInt(match[0], 10) : 5;
}

// ── 本地验证（不调 LLM）──────────────────────────────────

describe("eval cases structure", () => {
  test("EVAL_CASES 结构完整性（不消耗 token）", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(3);

    const names = EVAL_CASES.map((c) => c.name);
    expect(names.some((n) => n.includes("正面"))).toBe(true);
    expect(names.some((n) => n.includes("负面"))).toBe(true);
    expect(names.some((n) => n.includes("边界"))).toBe(true);

    for (const evalCase of EVAL_CASES) {
      expect(evalCase).toHaveProperty("name");
      expect(evalCase).toHaveProperty("input");
      expect(evalCase).toHaveProperty("expected");
    }
  });
});

// ── LLM 评估测试（消耗 token）────────────────────────────

const skipSlow = process.env.RUN_SLOW !== "1";

describe("LLM Eval Tests", () => {
  test.skipIf(skipSlow)("正面案例：技术内容应生成有意义的分析", async () => {
    const evalCase = EVAL_CASES[0]!;
    const prompt = `请分析以下技术内容，输出 200 字以内的中文摘要：\n${evalCase.input}`;
    const { content: result } = await chat(prompt, "你是技术分析师。");

    assertEvalResult(result, evalCase.expected);
  });

  test.skipIf(skipSlow)("负面案例：无关内容应被识别", async () => {
    const evalCase = EVAL_CASES[1]!;
    const prompt = `请判断以下内容是否与 AI 技术相关，如果不相关请说明：\n${evalCase.input}`;
    const { content: result } = await chat(prompt, "你是技术内容筛选器。");

    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
    assertEvalResult(result, evalCase.expected);
  });

  test.skipIf(skipSlow)("边界案例：极短输入不应崩溃", async () => {
    const evalCase = EVAL_CASES[2]!;
    const { content: result } = await chat(
      `请分析：${evalCase.input}`,
      "你是技术分析师。",
    );

    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
    assertEvalResult(result, evalCase.expected);
  });

  test.skipIf(skipSlow)("正面案例：英文技术内容应生成有效分析", async () => {
    const evalCase = EVAL_CASES[3]!;
    const prompt = `Analyze the following technical content and provide a brief summary:\n${evalCase.input}`;
    const { content: result } = await chat(prompt, "You are a technical analyst.");

    assertEvalResult(result, evalCase.expected);
  });

  test.skipIf(skipSlow)("LLM-as-Judge：对分析质量打分", async () => {
    const { content: analysis } = await chat(
      "请分析 LangGraph 框架的核心优势和适用场景",
      "你是技术分析师。输出 Markdown 格式。",
    );

    const judgePrompt = `请对以下技术分析的质量打分（1-10分）。

分析内容：
${analysis}

评分标准：
- 准确性：信息是否正确
- 深度：是否有洞察
- 实用性：读者能否据此行动

只返回一个数字（1-10），不要解释。`;

    const { content: scoreText } = await chat(
      judgePrompt,
      "你是质量评审。只返回数字。",
    );

    const score = parseJudgeScore(scoreText);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
    expect(score).toBeGreaterThanOrEqual(5);
  });
});
