#!/usr/bin/env tsx

/**
 * 知识条目 JSON 校验脚本。
 *
 * 用法：tsx hooks/validate-json.ts <json_file> [json_file2 ...]
 * 支持单文件和多文件（含通配符 *.json）两种输入模式。
 * 校验通过 exit 0，失败 exit 1 + 错误列表 + 汇总统计。
 */

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

const TOPIC_VALUES = ["ai", "frontend"] as const;

const STATUS_VALUES = ["draft", "review", "published", "archived"] as const;

// ID 格式：{source}_{hash8}（例：github_trending_a3f2b1c8）或 UUID
const ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// {source}_{hash8} 或 {source}-{YYYY}-{MM}-{DD}-{seq} 等多种格式
const ID_SOURCE_HASH8_RE = /^[a-z][a-z0-9_-]{4,}$/;

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface KnowledgeArticle {
  id: string;
  title: string;
  source: string;
  source_url: string;
  summary: string;
  highlights?: string[];
  score: number;
  tags: string[];
  collected_at: string;
  topic?: string;
  status?: string;
  score_reason?: string;
  author?: string;
  published_at?: string;
  analyzed_at?: string;
  raw_ref?: string;
  description?: string;
  stars?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 字段校验辅助函数
// ---------------------------------------------------------------------------

function requireString(
  obj: Record<string, unknown>,
  field: string,
  errors: FileError[],
): string | undefined {
  const val = obj[field];
  if (val === undefined) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  if (typeof val !== "string") {
    errors.push({ field, message: `${field} 必须是字符串` });
    return undefined;
  }
  if (val.trim().length === 0) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  return val;
}

function requireEnum(
  obj: Record<string, unknown>,
  field: string,
  values: readonly string[],
  errors: FileError[],
): string | undefined {
  const val = obj[field];
  if (val === undefined) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  if (typeof val !== "string") {
    errors.push({
      field,
      message: `${field} 必须是 ${values.join(" | ")} 之一`,
    });
    return undefined;
  }
  if (!values.includes(val)) {
    errors.push({
      field,
      message: `${field} 必须是 ${values.join(" | ")} 之一`,
    });
    return undefined;
  }
  return val;
}

function requireArray(
  obj: Record<string, unknown>,
  field: string,
  minLen: number,
  maxLen: number,
  errors: FileError[],
): string[] | undefined {
  const val = obj[field];
  if (val === undefined) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  if (!Array.isArray(val)) {
    errors.push({ field, message: `${field} 必须是数组` });
    return undefined;
  }
  if (val.length < minLen) {
    errors.push({ field, message: `${field} 至少需要 ${minLen} 项` });
    return undefined;
  }
  if (val.length > maxLen) {
    errors.push({ field, message: `${field} 最多 ${maxLen} 项` });
    return undefined;
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string") {
      errors.push({
        field: `${field}[${i}]`,
        message: "数组元素必须是字符串",
      });
    }
  }
  if (errors.some((e) => e.field.startsWith(`${field}[`))) return undefined;
  return val as string[];
}

function requireInt(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  errors: FileError[],
): number | undefined {
  const val = obj[field];
  if (val === undefined) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  if (typeof val !== "number" || Number.isNaN(val)) {
    errors.push({ field, message: `${field} 必须是数字` });
    return undefined;
  }
  if (!Number.isInteger(val)) {
    errors.push({ field, message: `${field} 必须是整数` });
    return undefined;
  }
  if (val < min) {
    errors.push({ field, message: `${field} 最小值为 ${min}` });
    return undefined;
  }
  if (val > max) {
    errors.push({ field, message: `${field} 最大值为 ${max}` });
    return undefined;
  }
  return val;
}

function requireFloat(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  errors: FileError[],
): number | undefined {
  const val = obj[field];
  if (val === undefined) {
    errors.push({ field, message: `${field} 不能为空` });
    return undefined;
  }
  if (typeof val !== "number" || Number.isNaN(val)) {
    errors.push({ field, message: `${field} 必须是数字` });
    return undefined;
  }
  if (val < min) {
    errors.push({ field, message: `${field} 最小值为 ${min}` });
    return undefined;
  }
  if (val > max) {
    errors.push({ field, message: `${field} 最大值为 ${max}` });
    return undefined;
  }
  return val;
}

function optionalString(
  obj: Record<string, unknown>,
  field: string,
  errors: FileError[],
): string | undefined {
  const val = obj[field];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") {
    errors.push({ field, message: `${field} 必须是字符串` });
    return undefined;
  }
  return val;
}

function optionalEnum(
  obj: Record<string, unknown>,
  field: string,
  values: readonly string[],
  errors: FileError[],
): string | undefined {
  const val = obj[field];
  if (val === undefined) return undefined;
  if (typeof val !== "string") {
    errors.push({
      field,
      message: `${field} 必须是 ${values.join(" | ")} 之一`,
    });
    return undefined;
  }
  if (!values.includes(val)) {
    errors.push({
      field,
      message: `${field} 必须是 ${values.join(" | ")} 之一`,
    });
    return undefined;
  }
  return val;
}

function optionalNumber(
  obj: Record<string, unknown>,
  field: string,
  errors: FileError[],
): number | undefined {
  const val = obj[field];
  if (val === undefined) return undefined;
  if (typeof val !== "number" || Number.isNaN(val)) {
    errors.push({ field, message: `${field} 必须是数字` });
    return undefined;
  }
  return val;
}

function optionalRecord(
  obj: Record<string, unknown>,
  field: string,
  errors: FileError[],
): Record<string, unknown> | undefined {
  const val = obj[field];
  if (val === undefined) return undefined;
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    errors.push({ field, message: `${field} 必须是对象` });
    return undefined;
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Schema 校验
// ---------------------------------------------------------------------------

function validateKnowledgeArticle(
  data: unknown,
): { ok: true; data: KnowledgeArticle } | { ok: false; errors: FileError[] } {
  const errors: FileError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "(顶级)", message: "必须是对象" });
    return { ok: false, errors };
  }

  const obj = data as Record<string, unknown>;

  const id = requireString(obj, "id", errors);
  const title = requireString(obj, "title", errors);
  const source = requireString(obj, "source", errors);
  const source_url = requireString(obj, "source_url", errors);
  const summary = requireString(obj, "summary", errors);
  const highlights = obj["highlights"] !== undefined
    ? requireArray(obj, "highlights", 1, 10, errors)
    : undefined;
  const score = requireFloat(obj, "score", 0, 1, errors);
  const tags = requireArray(obj, "tags", 1, 5, errors);
  const collected_at = requireString(obj, "collected_at", errors);

  const topic = optionalEnum(obj, "topic", TOPIC_VALUES, errors);
  const status = requireEnum(obj, "status", STATUS_VALUES, errors);
  const score_reason = optionalString(obj, "score_reason", errors);
  const author = optionalString(obj, "author", errors);
  const published_at = optionalString(obj, "published_at", errors);
  const analyzed_at = optionalString(obj, "analyzed_at", errors);
  const raw_ref = optionalString(obj, "raw_ref", errors);
  const description = optionalString(obj, "description", errors);
  const stars = optionalNumber(obj, "stars", errors);
  const metadata = optionalRecord(obj, "metadata", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      id: id!,
      title: title!,
      source: source!,
      source_url: source_url!,
      summary: summary!,
      highlights,
      score: score!,
      tags: tags!,
      collected_at: collected_at!,
      topic,
      status,
      score_reason,
      author,
      published_at,
      analyzed_at,
      raw_ref,
      description,
      stars,
      metadata,
    },
  };
}

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

  // 跳过数组（如 index.json）
  if (Array.isArray(result.data)) {
    return { file: filePath, passed: false, errors: [], skipped: "数组文件，非文章对象" };
  }

  // Schema 校验
  const parsed = validateKnowledgeArticle(result.data);
  if (!parsed.ok) {
    errors.push(...parsed.errors);
    return { file: filePath, passed: false, errors };
  }

  const article = parsed.data;

  // 自定义校验
  validateId(article.id, errors);
  validateUrl(article.source_url, errors);
  validateSummary(article.summary, errors);
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
