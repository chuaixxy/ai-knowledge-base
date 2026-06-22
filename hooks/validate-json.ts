#!/usr/bin/env tsx

/**
 * 知识条目 JSON 校验脚本。
 *
 * 用法：tsx hooks/validate-json.ts <json_file> [json_file2 ...]
 * 支持单文件和多文件（含通配符 *.json）两种输入模式。
 * 校验通过 exit 0，失败 exit 1 + 错误列表 + 汇总统计。
 */

import { z } from "zod";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface FileError {
  field: string;
  message: string;
}

interface FileResult {
  file: string;
  passed: boolean;
  errors: FileError[];
  skipped?: string;
}

interface Summary {
  total: number;
  passed: number;
  failed: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const SOURCE_VALUES = [
  "github_trending",
  "hacker_news",
  "juejin",
  "wechat",
] as const;

const TOPIC_VALUES = ["ai", "frontend"] as const;

const STATUS_VALUES = ["draft", "reviewed", "published", "archived"] as const;

// ID 格式：{source}_{hash8}（例：github_trending_a3f2b1c8）或 UUID
const ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_SOURCE_HASH8_RE = /^(github_trending|hacker_news|juejin|wechat)_[a-f0-9]{8}$/;

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

const KnowledgeArticleSchema = z.object({
  id: z.string().min(1, "id 不能为空"),
  title: z.string().min(1, "title 不能为空"),
  source: z.enum(SOURCE_VALUES, {
    errorMap: () => ({
      message: `source 必须是 ${SOURCE_VALUES.join(" | ")} 之一`,
    }),
  }),
  source_url: z.string().min(1, "source_url 不能为空"),
  summary: z.string().min(1, "summary 不能为空"),
  highlights: z
    .array(z.string())
    .min(2, "highlights 至少需要 2 项")
    .max(3, "highlights 最多 3 项"),
  score: z
    .number({ invalid_type_error: "score 必须是数字" })
    .int("score 必须是整数")
    .min(1, "score 最小值为 1")
    .max(10, "score 最大值为 10"),
  tags: z
    .array(z.string())
    .min(2, "tags 至少需要 2 个")
    .max(5, "tags 最多 5 个"),
  collected_at: z.string().min(1, "collected_at 不能为空"),
  // 可选字段
  topic: z
    .enum(TOPIC_VALUES, {
      errorMap: () => ({
        message: `topic 必须是 ${TOPIC_VALUES.join(" | ")} 之一`,
      }),
    })
    .optional(),
  status: z
    .enum(STATUS_VALUES, {
      errorMap: () => ({
        message: `status 必须是 ${STATUS_VALUES.join(" | ")} 之一`,
      }),
    })
    .optional(),
  score_reason: z.string().optional(),
  author: z.string().optional(),
  published_at: z.string().optional(),
  analyzed_at: z.string().optional(),
  raw_ref: z.string().optional(),
  description: z.string().optional(),
  stars: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// 自定义校验
// ---------------------------------------------------------------------------

/**
 * 校验 ID 格式：{source}_{hash8} 或 UUID。
 */
function validateId(id: string, errors: FileError[]): void {
  if (ID_UUID_RE.test(id)) {
    return;
  }
  if (ID_SOURCE_HASH8_RE.test(id)) {
    return;
  }
  errors.push({
    field: "id",
    message: `ID 格式无效（期望 {source}_{hash8} 或 UUID，实际 "${id}"）`,
  });
}

/**
 * 校验 URL 格式（https?://...）。
 */
function validateUrl(url: string, errors: FileError[]): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    errors.push({
      field: "source_url",
      message: `URL 格式无效 "${url}"`,
    });
  }
}

/**
 * 校验 summary 长度（≥20 字且 ≤100 字，中文按字符数计）。
 */
function validateSummary(summary: string, errors: FileError[]): void {
  const len = summary.length;
  if (len < 20) {
    errors.push({
      field: "summary",
      message: `摘要过短（${len} 字，要求 ≥20 字）`,
    });
  } else if (len > 100) {
    errors.push({
      field: "summary",
      message: `摘要过长（${len} 字，要求 ≤100 字）`,
    });
  }
}

/**
 * 校验 highlights 每项长度（不超过 40 字）。
 */
function validateHighlights(
  highlights: string[],
  errors: FileError[],
): void {
  highlights.forEach((item, i) => {
    if (item.length > 40) {
      errors.push({
        field: `highlights[${i}]`,
        message: `亮点过长（${item.length} 字，要求每项 ≤40 字）："${item.substring(0, 40)}..."`,
      });
    }
  });
}

/**
 * 校验 score_reason（如有则必须为非空字符串）。
 */
function validateScoreReason(
  reason: string | undefined,
  errors: FileError[],
): void {
  if (reason !== undefined && reason.trim().length === 0) {
    errors.push({
      field: "score_reason",
      message: "score_reason 不能为空字符串",
    });
  }
}

// ---------------------------------------------------------------------------
// 文件操作
// ---------------------------------------------------------------------------

/**
 * 解析命令行参数中的通配符（*.json），返回实际文件列表。
 * 若传入路径为精确文件则直接返回；若含 * 则在对应目录下匹配。
 */
function resolveFiles(args: string[]): string[] {
  const files: string[] = [];

  for (const arg of args) {
    if (arg.includes("*")) {
      const dir = dirname(arg) || ".";
      const pattern = basename(arg);
      // 仅支持 *.json 等简单通配符
      if (pattern === "*.json") {
        try {
          const entries = readdirSync(dir);
          for (const entry of entries) {
            if (entry.endsWith(".json")) {
              files.push(resolve(dir, entry));
            }
          }
        } catch {
          console.error(`无法读取目录：${dir}`);
        }
      } else {
        console.error(`不支持的通配符模式：${arg}`);
      }
    } else {
      files.push(resolve(arg));
    }
  }

  return files;
}

/**
 * 读取并解析 JSON 文件，返回解析结果或错误。
 */
function readJson(
  filePath: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// 单文件校验
// ---------------------------------------------------------------------------

/**
 * 校验单个 JSON 文件。
 */
function validateFile(filePath: string): FileResult {
  const errors: FileError[] = [];

  // 检查文件是否存在
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return {
        file: filePath,
        passed: false,
        errors: [],
        skipped: "非文件路径",
      };
    }
  } catch {
    return {
      file: filePath,
      passed: false,
      errors: [{ field: "(文件)", message: `文件不存在：${filePath}` }],
    };
  }

  // 解析 JSON
  const result = readJson(filePath);
  if (!result.ok) {
    return {
      file: filePath,
      passed: false,
      errors: [
        { field: "(JSON)", message: `JSON 解析失败：${result.error}` },
      ],
    };
  }

  // Zod schema 校验
  const parsed = KnowledgeArticleSchema.safeParse(result.data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      errors.push({
        field: field || "(顶级)",
        message: issue.message,
      });
    }
    return { file: filePath, passed: false, errors };
  }

  const article = parsed.data;

  // 自定义校验
  validateId(article.id, errors);
  validateUrl(article.source_url, errors);
  validateSummary(article.summary, errors);
  validateHighlights(article.highlights, errors);
  validateScoreReason(article.score_reason, errors);

  return {
    file: filePath,
    passed: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("用法：tsx hooks/validate-json.ts <json_file> [json_file2 ...]");
    console.error("示例：tsx hooks/validate-json.ts knowledge/articles/*.json");
    process.exit(1);
  }

  const files = resolveFiles(args);

  if (files.length === 0) {
    console.error("未找到匹配的 JSON 文件");
    process.exit(1);
  }

  console.log(`检查 ${files.length} 个文件...\n`);

  const results: FileResult[] = [];

  for (const file of files) {
    const result = validateFile(file);
    results.push(result);

    if (result.skipped) {
      console.log(`SKIP ${file} (${result.skipped})`);
    } else if (result.passed) {
      console.log(`PASS ${file}`);
    } else {
      console.log(`FAIL ${file}`);
      for (const err of result.errors) {
        console.log(`  ${err.field}: ${err.message}`);
      }
      console.log();
    }
  }

  // 汇总统计
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.skipped).length;
  const errorCount = results.reduce(
    (sum, r) => sum + (r.errors.length || 0),
    0,
  );

  console.log(
    `汇总：${files.length} 个文件，${passed} 通过，${failed} 失败` +
      (skipped > 0 ? `，${skipped} 跳过` : "") +
      (errorCount > 0 ? `（${errorCount} 个错误）` : ""),
  );

  process.exit(failed > 0 ? 1 : 0);
}

main();
