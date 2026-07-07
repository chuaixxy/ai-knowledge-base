/**
 * HumanFlag 节点 — 审核循环熔断器
 *
 * 当审核循环达到 MAX_ITERATIONS 次仍未通过时由 graph.ts 路由到此节点。
 * 问题条目写入 knowledge/flagged/ 独立目录，附带审核反馈，等待人工判断。
 * 不写入 articles/ 和 index.json，不污染主知识库。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { KBState } from "./state.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const FLAGGED_DIR = join(ROOT_DIR, "knowledge", "flagged");

function nowUtcIso(): string {
  return new Date().toISOString();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function humanFlagNode(
  state: KBState,
): Promise<Partial<KBState>> {
  const { analyses, review_feedback, iteration } = state;

  console.warn(
    `[HumanFlag] 审核循环超限（已审核 ${iteration} 次），转入人工复核`,
  );

  mkdirSync(FLAGGED_DIR, { recursive: true });

  // 文件名含日期和迭代轮次，方便人工定位
  const filename = `${todayUtc()}-iter${iteration}.json`;
  const filepath = join(FLAGGED_DIR, filename);

  const payload = {
    flagged_at: nowUtcIso(),
    iteration,
    review_feedback,
    analyses_count: analyses.length,
    analyses,
  };

  writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf-8");

  console.warn(
    `[HumanFlag] 已写入 ${filepath}（${analyses.length} 条待人工审查）`,
  );

  return {};
}
