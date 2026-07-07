/**
 * distribution/daily-digest.ts
 *
 * 每日推送 CLI 入口。
 *
 * 用法：
 *   npx tsx distribution/daily-digest.ts
 *   npx tsx distribution/daily-digest.ts --date 2026-07-08
 *   npx tsx distribution/daily-digest.ts --date 2026-07-08 --score 0.7 --dir knowledge/articles
 *
 * 流程：
 *   1. 加载当日文章
 *   2. 过滤 relevance_score < SCORE_THRESHOLD 的低质量文章
 *   3. 无合格文章 → 打印警告并 exit(0)
 *   4. 有合格文章 → 调用 publishDailyDigest() 并发推送到所有已配置渠道
 *   5. 打印推送结果汇总
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Article } from "./formatter.js";
import { publishDailyDigest } from "./publisher.js";
import type { PublishResult } from "./publisher.js";

// ── 常量 ──────────────────────────────────────────────────────────────────────

/** 默认评分阈值：低于此值的文章视为低质量。 */
const DEFAULT_SCORE_THRESHOLD = 0.6;

/** 默认文章目录。 */
const DEFAULT_KNOWLEDGE_DIR = "knowledge/articles";

// ── CLI 参数解析 ───────────────────────────────────────────────────────────────

interface CliArgs {
  date: string;
  scoreThreshold: number;
  knowledgeDir: string;
}

/**
 * 从 process.argv 解析 CLI 参数。
 *
 * 支持：
 * - `--date YYYY-MM-DD`  覆盖日期（默认今天）
 * - `--score 0.6`        覆盖评分阈值（默认 0.6）
 * - `--dir <path>`       覆盖文章目录（默认 knowledge/articles）
 */
function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const rawDate = get("--date");
  const date = rawDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`[daily-digest] --date 格式错误，应为 YYYY-MM-DD，实际收到 "${date}"`);
    process.exit(1);
  }

  const rawScore = get("--score");
  const scoreThreshold = rawScore !== undefined ? parseFloat(rawScore) : DEFAULT_SCORE_THRESHOLD;
  if (isNaN(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 1) {
    console.error(`[daily-digest] --score 应为 0~1 之间的浮点数，实际收到 "${rawScore}"`);
    process.exit(1);
  }

  const knowledgeDir = get("--dir") ?? DEFAULT_KNOWLEDGE_DIR;

  return { date, scoreThreshold, knowledgeDir };
}

// ── 文章加载 ──────────────────────────────────────────────────────────────────

/**
 * 加载指定日期的全部文章 JSON。
 *
 * @param date         - YYYY-MM-DD
 * @param knowledgeDir - 文章目录
 */
async function loadArticles(date: string, knowledgeDir: string): Promise<Article[]> {
  const files = await readdir(knowledgeDir);
  const dayFiles = files.filter((f) => f.startsWith(date) && f.endsWith(".json"));
  if (dayFiles.length === 0) return [];
  return Promise.all(
    dayFiles.map(async (f) => {
      const raw = await readFile(join(knowledgeDir, f), "utf-8");
      return JSON.parse(raw) as Article;
    })
  );
}

// ── 结果打印 ──────────────────────────────────────────────────────────────────

/** 打印推送结果汇总及逐条明细。 */
function printResults(results: PublishResult[]): void {
  if (results.length === 0) {
    console.log("[daily-digest] 无推送结果（可能未配置任何渠道）");
    return;
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const allChannels = [...new Set(results.map((r) => r.channel))];
  const failedChannels = [...new Set(failed.map((r) => r.channel))];
  const successChannels = allChannels.filter((c) => !failedChannels.includes(c));

  console.log(
    `\n推送汇总：成功渠道 ${successChannels.length}/${allChannels.length}` +
      `，消息 ${succeeded.length} 条成功 / ${failed.length} 条失败`
  );

  for (const r of results) {
    if (r.success) {
      const id = r.messageId ? ` → ${r.messageId}` : "";
      console.log(`  ✓ [${r.channel}]${id}`);
    } else {
      console.error(`  ✗ [${r.channel}] ${r.error ?? "未知错误"}`);
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { date, scoreThreshold, knowledgeDir } = parseArgs();

  console.log(`[daily-digest] 日期: ${date}，评分阈值: ${scoreThreshold}，目录: ${knowledgeDir}`);

  // 1. 加载当日文章
  let articles: Article[];
  try {
    articles = await loadArticles(date, knowledgeDir);
  } catch (err) {
    console.error(`[daily-digest] 读取文章目录失败: ${err}`);
    process.exit(1);
  }

  if (articles.length === 0) {
    console.warn(`[daily-digest] ${date} 无文章，跳过推送`);
    process.exit(0);
  }

  // 2. 过滤低质量文章
  const qualified = articles.filter((a) => a.relevance_score >= scoreThreshold);

  console.log(
    `[daily-digest] 共 ${articles.length} 篇文章，` +
      `合格（>= ${scoreThreshold}）${qualified.length} 篇，` +
      `过滤 ${articles.length - qualified.length} 篇`
  );

  // 3. 无合格文章 → 跳过
  if (qualified.length === 0) {
    console.warn(
      `[daily-digest] ${date} 所有文章评分均低于 ${scoreThreshold}，无合格内容，跳过推送`
    );
    process.exit(0);
  }

  // 4. 推送到所有已配置渠道
  console.log("[daily-digest] 开始推送...");
  const results = await publishDailyDigest({ date, knowledgeDir });

  // 5. 打印结果汇总
  printResults(results);

  const anyFailed = results.some((r) => !r.success);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[daily-digest] 未预期错误:", err);
  process.exit(1);
});
