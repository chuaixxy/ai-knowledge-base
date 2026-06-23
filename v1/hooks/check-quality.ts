#!/usr/bin/env tsx

/**
 * 知识条目 5 维度质量评分脚本。
 *
 * 用法：tsx hooks/check_quality.ts <json_file> [json_file2 ...]
 * 支持单文件和多文件（含通配符 *.json）两种输入模式。
 * 全部 A/B 级 exit 0，存在 C 级 exit 1。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface DimensionScore {
  name: string;
  maxScore: number;
  actualScore: number;
  detail: string;
}

interface QualityReport {
  file: string;
  title: string;
  dimensions: DimensionScore[];
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 标准标签列表 */
const STANDARD_TAGS = new Set([
  "agent", "rag", "mcp", "llm", "fine-tuning", "prompt-engineering",
  "multi-agent", "tool-use", "evaluation", "deployment", "security",
  "reasoning", "code-generation", "vision", "audio", "robotics",
]);

/** 中文空洞词黑名单 */
const CN_BUZZWORDS = [
  "赋能", "抓手", "闭环", "打通", "全链路", "底层逻辑",
  "颗粒度", "对齐", "拉通", "沉淀", "强大的", "革命性的",
];

/** 英文空洞词黑名单 */
const EN_BUZZWORDS = [
  "groundbreaking", "revolutionary", "game-changing", "cutting-edge",
  "state-of-the-art", "leverage", "synergy", "paradigm shift",
  "disruptive", "next-generation", "world-class",
];

/** 技术关键词（用于摘要质量评分奖励） */
const TECH_KEYWORDS = [
  "agent", "llm", "rag", "fine-tun", "prompt", "multi-agent",
  "tool", "evaluat", "benchmark", "safety", "alignment",
  "reasoning", "code-generat", "inference", "train",
  "embedding", "vector", "retrieval", "knowledge",
  "mcp", "workflow", "orchestrat", "pipeline",
  "transformer", "attention", "context",
  "quantiz", "open-source", "deploy",
  "模型", "微调", "推理", "训练", "智能体",
  "工具调用", "知识图谱", "语义", "向量",
  "开源", "上下文", "思维链", "多模态",
  "部署", "评估", "框架", "协议",
];

// ---------------------------------------------------------------------------
// 辅助函数（计算属性）
// ---------------------------------------------------------------------------

function getPercentage(dim: DimensionScore): number {
  return Math.round((dim.actualScore / dim.maxScore) * 100);
}

function getTotalScore(report: QualityReport): number {
  const sum = report.dimensions.reduce((s, d) => s + d.actualScore, 0);
  return Math.round(sum * 10) / 10;
}

function getGrade(totalScore: number): "A" | "B" | "C" {
  if (totalScore >= 80) return "A";
  if (totalScore >= 60) return "B";
  return "C";
}

// ---------------------------------------------------------------------------
// 文件操作（与 validate-json.ts 保持一致）
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
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
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
// 5 维度评分实现
// ---------------------------------------------------------------------------

/**
 * 维度 1：摘要质量（满分 25 分）
 *   ≥50 字 → 22 分基础分
 *   ≥20 字 → 15 分基础分
 *   <20 字 → 0 分
 *   含技术关键词额外 +1-3 分
 */
function scoreSummary(data: Record<string, unknown>): DimensionScore {
  const summary = String(data.summary ?? "");
  const len = summary.length;
  let score = 0;
  const parts: string[] = [];

  if (len >= 50) {
    score = 22;
    parts.push(`长度 ${len} 字（≥50）`);
  } else if (len >= 20) {
    score = 15;
    parts.push(`长度 ${len} 字（≥20）`);
  } else {
    parts.push(`长度 ${len} 字（<20）`);
  }

  // 技术关键词奖励（每命中 1 个 +1，最多 +3）
  const lower = summary.toLowerCase();
  let hits = 0;
  for (const kw of TECH_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      hits++;
    }
  }
  const bonus = Math.min(hits, 3);
  score += bonus;
  if (bonus > 0) parts.push(`技术关键词 +${bonus}`);

  return {
    name: "摘要质量",
    maxScore: 25,
    actualScore: Math.min(score, 25),
    detail: parts.join("，"),
  };
}

/**
 * 维度 2：技术深度（满分 25 分）
 *   基于文章 score 字段（1-10）线性映射到 0-25：actual = score × 2.5
 */
function scoreTechDepth(data: Record<string, unknown>): DimensionScore {
  const raw = Number(data.score ?? 0);
  const mapped = Math.round(raw * 2.5 * 10) / 10;
  return {
    name: "技术深度",
    maxScore: 25,
    actualScore: Math.min(mapped, 25),
    detail: `原始 score=${raw} → ${mapped.toFixed(1)}/25`,
  };
}

/**
 * 维度 3：格式规范（满分 20 分）
 *   id、title、source_url、status、时间戳五项各 4 分
 */
function scoreFormat(data: Record<string, unknown>): DimensionScore {
  let score = 0;
  const parts: string[] = [];

  // id (4 分)：支持 UUID / {source}_{hash8} / arXiv 论文 ID 格式
  const id = String(data.id ?? "");
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // github_trending / hacker_news / juejin / wechat：source_ + 8 位十六进制
  const sourceHashRe =
    /^(github_trending|hacker_news|juejin|wechat)_[a-f0-9]{8}$/;
  // arxiv：source_ + 论文 ID（YYMM.NNNNN 或 YYMMNNNN）
  const arxivIdRe = /^arxiv_\d{4}(\.\d{4,5}|\.\d{4}v\d+|\d{4})$/;
  if (id && (uuidRe.test(id) || sourceHashRe.test(id) || arxivIdRe.test(id))) {
    score += 4;
  } else if (id) {
    score += 2;
    parts.push("id 格式不标准");
  } else {
    parts.push("id 缺失");
  }

  // title (4 分)
  const title = String(data.title ?? "");
  if (title.length > 0) {
    score += 4;
  } else {
    parts.push("title 缺失");
  }

  // source_url (4 分)
  const url = String(data.source_url ?? "");
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      score += 4;
    } else {
      parts.push("source_url 协议无效");
    }
  } catch {
    if (url) parts.push("source_url 格式无效");
    else parts.push("source_url 缺失");
  }

  // status (4 分)：必填，有效枚举值才给满分
  const statusValues = ["draft", "review", "published", "archived"];
  const status = data.status as string | undefined;
  if (status && statusValues.includes(status)) {
    score += 4;
  } else if (status) {
    score += 1;
    parts.push(`status 值无效: ${status}`);
  } else {
    parts.push("status 缺失");
  }

  // 时间戳 (4 分)：collected_at 需为 ISO 8601 格式
  const ts = String(data.collected_at ?? "");
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (ts && isoRe.test(ts)) {
    score += 4;
  } else if (ts) {
    score += 1;
    parts.push("时间戳格式不标准");
  } else {
    parts.push("collected_at 缺失");
  }

  return {
    name: "格式规范",
    maxScore: 20,
    actualScore: score,
    detail: parts.length > 0 ? parts.join("；") : "全部通过",
  };
}

/**
 * 维度 4：标签精度（满分 15 分）
 *   1-3 个全部合法标签 → 15 分（最佳）
 *   4-5 个全部合法标签 → 12 分
 *   ＞5 个全部合法标签 → 8 分
 *   含非法标签每个扣 2 分
 */
function scoreTags(data: Record<string, unknown>): DimensionScore {
  const tags = (data.tags ?? []) as string[];
  const valid = tags.filter((t) => STANDARD_TAGS.has(t));
  const invalid = tags.filter((t) => !STANDARD_TAGS.has(t));
  const parts: string[] = [];

  let score = 0;

  // 按数量评分
  if (tags.length === 0) {
    parts.push("无标签");
  } else if (tags.length >= 1 && tags.length <= 3) {
    score = 15;
  } else if (tags.length <= 5) {
    score = 12;
  } else {
    score = 8;
  }

  // 非法标签扣分
  score = Math.max(0, score - invalid.length * 2);

  if (invalid.length > 0) {
    parts.push(`非标准标签: ${invalid.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push(`${valid.length} 个标签，全部合法`);
  }

  return {
    name: "标签精度",
    maxScore: 15,
    actualScore: Math.min(score, 15),
    detail: parts.join("；"),
  };
}

/**
 * 维度 5：空洞词检测（满分 15 分）
 *   无空洞词 → 15 分
 *   1-2 个 → 10 分
 *   3+ 个 → 每多 1 个扣 3 分，最低 0 分
 *   检查范围：summary、title、description、highlights
 */
function scoreBuzzwords(data: Record<string, unknown>): DimensionScore {
  const fields = [
    String(data.summary ?? ""),
    String(data.title ?? ""),
    String(data.description ?? ""),
    ...((data.highlights ?? []) as string[]),
  ];
  const text = fields.join(" ");
  const textLower = text.toLowerCase();

  const foundCN = CN_BUZZWORDS.filter((w) => text.includes(w));
  const foundEN = EN_BUZZWORDS.filter((w) => textLower.includes(w));
  const allFound = [...new Set([...foundCN, ...foundEN])];

  let score = 15;
  let detail = "";

  if (allFound.length === 0) {
    detail = "未检测到空洞词";
  } else if (allFound.length <= 2) {
    score = 10;
    detail = `检测到空洞词: ${allFound.join(", ")}`;
  } else {
    score = Math.max(0, 15 - allFound.length * 3);
    detail = `检测到 ${allFound.length} 个空洞词: ${allFound.join(", ")}`;
  }

  return {
    name: "空洞词检测",
    maxScore: 15,
    actualScore: score,
    detail,
  };
}

// ---------------------------------------------------------------------------
// 单文件评分
// ---------------------------------------------------------------------------

/**
 * 对单个 JSON 文件执行 5 维度评分，返回 QualityReport 或 null（跳过）。
 */
function scoreFile(filePath: string): QualityReport | null {
  // 跳过 index.json
  if (basename(filePath) === "index.json") {
    console.log(`SKIP ${filePath} (索引文件)`);
    return null;
  }

  // 检查文件存在
  try {
    const st = statSync(filePath);
    if (!st.isFile()) {
      console.error(`SKIP ${filePath} (非文件)`);
      return null;
    }
  } catch {
    console.error(`SKIP ${filePath} (文件不存在)`);
    return null;
  }

  // 解析 JSON
  const result = readJson(filePath);
  if (!result.ok) {
    console.error(`SKIP ${filePath} (JSON 解析失败: ${result.error})`);
    return null;
  }

  const data = result.data;
  const dimensions = [
    scoreSummary(data),
    scoreTechDepth(data),
    scoreFormat(data),
    scoreTags(data),
    scoreBuzzwords(data),
  ];

  return {
    file: filePath,
    title: String(data.title ?? "unknown"),
    dimensions,
  };
}

// ---------------------------------------------------------------------------
// 可视化输出
// ---------------------------------------------------------------------------

const BAR_WIDTH = 20;

function renderBar(pct: number): string {
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function printReport(report: QualityReport): void {
  const total = getTotalScore(report);
  const grade = getGrade(total);

  console.log("─".repeat(58));
  console.log(`  ${report.file}`);
  console.log(`  ${report.title}`);
  console.log("─".repeat(58));

  for (const dim of report.dimensions) {
    const pct = getPercentage(dim);
    const bar = renderBar(pct);
    const pctStr = String(pct).padStart(3, " ");
    const scoreStr = `${dim.actualScore}/${dim.maxScore}`;
    console.log(`  ${bar} ${pctStr}%  ${dim.name.padEnd(6, " ")} ${scoreStr}`);
    if (dim.detail) {
      console.log(`              ${dim.detail}`);
    }
  }

  console.log("─".repeat(58));

  const colors: Record<string, string> = {
    A: "\x1b[32m",
    B: "\x1b[33m",
    C: "\x1b[31m",
  };
  const color = colors[grade] ?? "";
  console.log(`  Total: ${total}/100 → ${color}Grade ${grade}\x1b[0m`);
  console.log("─".repeat(58));
  console.log();
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("用法：tsx hooks/check_quality.ts <json_file> [json_file2 ...]");
    console.error("示例：tsx hooks/check_quality.ts knowledge/articles/2026-06-22-001.json");
    console.error("示例：tsx hooks/check_quality.ts knowledge/articles/*.json");
    process.exit(1);
  }

  const files = resolveFiles(args);

  if (files.length === 0) {
    console.error("未找到匹配的 JSON 文件");
    process.exit(1);
  }

  console.log(`检查 ${files.length} 个文件...\n`);

  const reports: QualityReport[] = [];
  let skipped = 0;

  for (const file of files) {
    const report = scoreFile(file);
    if (report) {
      reports.push(report);
      printReport(report);
    } else {
      skipped++;
    }
  }

  // 汇总统计
  let gradeA = 0;
  let gradeB = 0;
  let gradeC = 0;

  for (const r of reports) {
    const g = getGrade(getTotalScore(r));
    if (g === "A") gradeA++;
    else if (g === "B") gradeB++;
    else gradeC++;
  }

  console.log(
    `汇总：${files.length} 个文件，${reports.length} 评分` +
      (skipped > 0 ? `，${skipped} 跳过` : ""),
  );
  console.log(`  A 级：${gradeA}   B 级：${gradeB}   C 级：${gradeC}`);

  if (gradeC > 0) {
    console.log(`\n⚠ 存在 ${gradeC} 个 C 级条目，需人工审阅。`);
  }

  process.exit(gradeC > 0 ? 1 : 0);
}

main();
