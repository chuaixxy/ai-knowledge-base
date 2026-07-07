/**
 * source_id 工具 — 与 pipeline/pipeline.ts 的去重逻辑对齐
 *
 * GitHub 仓库用 full_name（如 Snailclimb/JavaGuide），
 * 其他来源回退到 url / title。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ARTICLES_DIR = join(__dirname, "..", "knowledge", "articles");

/** 从条目中推导 source_id（兼容无 source_id 字段的历史文章）。 */
export function deriveSourceId(item: Record<string, unknown>): string {
  const explicit = String(item.source_id ?? "").trim();
  if (explicit) return explicit;

  const title = String(item.title ?? "").trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(title)) {
    return title;
  }

  const url = String(item.url ?? item.source_url ?? "").trim();
  if (url) {
    const githubMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/?#]+)/i);
    if (githubMatch?.[1]) return githubMatch[1];
    return url;
  }

  return title;
}

/**
 * 读取已有文章的 source_id 集合，用于跨天去重。
 * 与 pipeline.ts 的 loadExistingSourceIds 行为一致。
 */
export function loadExistingSourceIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(ARTICLES_DIR)) return ids;

  const files = readdirSync(ARTICLES_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );

  for (const file of files) {
    try {
      const article = JSON.parse(
        readFileSync(join(ARTICLES_DIR, file), "utf-8"),
      ) as Record<string, unknown>;
      const sourceId = deriveSourceId(article);
      if (sourceId) ids.add(sourceId);
    } catch {
      // 单文件读取失败不影响整体
    }
  }

  return ids;
}
