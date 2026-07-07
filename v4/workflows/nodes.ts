/**
 * 工作流节点统一出口
 *
 * 各节点已拆分为独立文件：
 *   planner.ts    — plannerNode
 *   collector.ts  — collectNode
 *   analyzer.ts   — analyzeNode
 *   organizer.ts  — organizeNode
 *   reviewer.ts   — reviewNode
 *   reviser.ts    — reviseNode
 *   human-flag.ts  — humanFlagNode
 *
 * 本文件保留 saveNode、reviewNodeTest，并重新导出所有节点，
 * 供外部代码通过单一入口引用。
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveSourceId } from "./source-id.ts";
import type { KBState } from "./state.ts";

export { plannerNode, planStrategy, type PlanStrategy } from "./planner.ts";
export { collectNode } from "./collector.ts";
export { analyzeNode } from "./analyzer.ts";
export { organizeNode } from "./organizer.ts";
export { reviewNode, REVIEWER_WEIGHTS, REVIEWER_PASS_THRESHOLD } from "./reviewer.ts";
export { reviseNode } from "./reviser.ts";
export { humanFlagNode } from "./human-flag.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const ARTICLES_DIR = join(ROOT_DIR, "knowledge", "articles");
const INDEX_FILE = join(ARTICLES_DIR, "index.json");

function nowUtcIso(): string {
  return new Date().toISOString();
}

/** 保存节点：写入 JSON 文件并更新 index.json */
export async function saveNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[SaveNode] 开始保存文章");

  const articles = state.articles;
  if (articles.length === 0) {
    console.log("[SaveNode] 没有条目需要保存");
    return {};
  }

  mkdirSync(ARTICLES_DIR, { recursive: true });

  for (const article of articles) {
    const id = String(article.id ?? "unknown");
    const filepath = join(ARTICLES_DIR, `${id}.json`);
    writeFileSync(filepath, JSON.stringify(article, null, 2), "utf-8");
  }

  // 读取已有索引，按 id 去重后追加新条目
  let index: Record<string, unknown>[] = [];
  if (existsSync(INDEX_FILE)) {
    try {
      index = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as Record<
        string,
        unknown
      >[];
    } catch {
      index = [];
    }
  }

  const existingIds = new Set(
    index.map((entry) => String(entry.id ?? "")),
  );

  let appended = 0;
  for (const article of articles) {
    const id = String(article.id ?? "");
    if (!id || existingIds.has(id)) continue;

    index.push({
      id,
      title: article.title ?? "",
      source: article.source ?? "",
      source_id: deriveSourceId(article),
      category: article.category ?? "",
      relevance_score: article.relevance_score ?? 0,
      tags: article.tags ?? [],
      status: "published",
      collected_at: article.collected_at ?? nowUtcIso(),
    });
    existingIds.add(id);
    appended += 1;
  }

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");

  console.log(
    `[SaveNode] 保存 ${articles.length} 篇文章，索引新增 ${appended} 条`,
  );
  return {};
}

/**
 * 测试用审核节点：前 2 次不通过，第 3 次通过（不调用 LLM）。
 * 验证审核循环后请改回 reviewNode。
 */
export async function reviewNodeTest(
  state: KBState,
): Promise<Partial<KBState>> {
  const iteration = state.iteration;
  const nextIteration = iteration + 1;

  const feedbacks = [
    "摘要过于简略，请补充技术细节和适用场景说明。",
    "标签数量不足且分类不准确，请重新标注并调整 category。",
    "条目质量已达标，格式与内容一致性良好，准予通过。",
  ];

  const passed = iteration >= 2;
  const feedback = feedbacks[Math.min(iteration, feedbacks.length - 1)];

  console.log(
    `[Reviewer-Test] iteration=${nextIteration}, review_passed=${passed}`,
  );
  console.log(`[Reviewer-Test] feedback: ${feedback}`);

  return {
    review_passed: passed,
    review_feedback: feedback,
    iteration: nextIteration,
  };
}
