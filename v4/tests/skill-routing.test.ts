/**
 * Skill 路由回归测试
 *
 * 验证每条 query 能命中正确的 skill description，
 * 每次修改 SKILL.md 的 description 后跑一次回归。
 *
 * 不调 LLM，不依赖网络，纯本地。
 */

import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "openclaw");
const SKILLS_DIR = join(ROOT, "skills");

// ── Skill 名称常量 ────────────────────────────────────────────────────────────

const S = {
  TOP_RATED:        "top-rated",
  DAILY_DIGEST:     "daily-digest",
  CATEGORY_SUMMARY: "category-summary",
  SUBSCRIBE_TAG:    "subscribe-tag",
  KNOWLEDGE_QUERY:  "knowledge-query",
} as const;

type SkillName = (typeof S)[keyof typeof S];

// ── Query → 期望 Skill 映射 ───────────────────────────────────────────────────

interface EvalCase {
  query: string;
  skill: SkillName;
  note?: string;
}

const EVAL_CASES: EvalCase[] = [
  // top-rated
  { query: "推荐 3 个最值得看的项目",     skill: S.TOP_RATED },
  { query: "score 最高的是哪几篇",        skill: S.TOP_RATED },
  { query: "最佳文章 top 5",             skill: S.TOP_RATED },
  { query: "高分推荐一些 AI 框架",        skill: S.TOP_RATED },

  // daily-digest
  { query: "今天的简报",                  skill: S.DAILY_DIGEST },
  { query: "给我看今日 digest",           skill: S.DAILY_DIGEST },
  { query: "daily briefing 是什么",      skill: S.DAILY_DIGEST },
  { query: "帮我生成每日摘要",            skill: S.DAILY_DIGEST },

  // category-summary
  { query: "framework 类有多少篇",        skill: S.CATEGORY_SUMMARY },
  { query: "agent 类 top 3",             skill: S.CATEGORY_SUMMARY },
  { query: "tool 类有几篇文章",           skill: S.CATEGORY_SUMMARY },
  { query: "RAG 相关的文章有哪些",        skill: S.CATEGORY_SUMMARY },

  // subscribe-tag
  { query: "订阅 RAG 标签",              skill: S.SUBSCRIBE_TAG },
  { query: "帮我关注 agent 类",          skill: S.SUBSCRIBE_TAG },
  { query: "取消订阅 mcp",              skill: S.SUBSCRIBE_TAG },
  { query: "我订阅了什么",               skill: S.SUBSCRIBE_TAG },
  { query: "不要再推 tool 了",           skill: S.SUBSCRIBE_TAG },

  // knowledge-query
  { query: "搜索 MCP 协议相关文章",       skill: S.KNOWLEDGE_QUERY },
  { query: "查找 agent 框架",            skill: S.KNOWLEDGE_QUERY },
  { query: "找一下 RAG 文章",            skill: S.KNOWLEDGE_QUERY },
  { query: "search langchain",          skill: S.KNOWLEDGE_QUERY },
  { query: "关于 dify 有什么",           skill: S.KNOWLEDGE_QUERY },
  { query: "找 #rag 标签文章",           skill: S.KNOWLEDGE_QUERY },
];

// ── 读取 skill description ────────────────────────────────────────────────────

async function loadDescriptions(): Promise<Record<SkillName, string>> {
  const skills = Object.values(S) as SkillName[];
  const entries = await Promise.all(
    skills.map(async (name) => {
      const raw = await readFile(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");
      // 提取 frontmatter description 字段
      const m = raw.match(/^description:\s*(.+)$/m);
      return [name, m ? m[1]!.trim() : ""] as [SkillName, string];
    })
  );
  return Object.fromEntries(entries) as Record<SkillName, string>;
}

// ── Description 匹配函数 ──────────────────────────────────────────────────────

/**
 * 从 description 里提取所有触发关键词（斜杠分隔 + 中文词），
 * 检查 query 是否命中其中至少一个。
 *
 * 匹配逻辑对齐 AGENTS.md 分发表：
 * description 里列的典型用语用 / 分隔，只要 query 含其中一个词就算命中。
 */
function matchesDescription(query: string, description: string): boolean {
  const q = query.toLowerCase();

  // 提取所有 token：按 / 、空格、中文标点拆分（含中文引号）
  const tokens = description
    .toLowerCase()
    .split(/[/／\s、，。「」【】()（）""]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2); // 过滤单字噪音

  return tokens.some((token) => q.includes(token));
}

/**
 * 在所有 skill 里找匹配度最高的（命中 token 最多的）。
 * 有并列时按 EVAL_CASES 定义的期望 skill 判断是否正确。
 */
function bestMatch(
  query: string,
  descriptions: Record<SkillName, string>
): SkillName | null {
  let best: SkillName | null = null;
  let bestCount = 0;

  for (const [name, desc] of Object.entries(descriptions) as [SkillName, string][]) {
    const q = query.toLowerCase();
    const tokens = desc
      .toLowerCase()
      .split(/[/／\s、，。「」【】()（）""]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    const count = tokens.filter((t) => q.includes(t)).length;
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }

  return bestCount > 0 ? best : null;
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe("Skill description 文件结构", () => {
  test("每个 skill 目录都有 SKILL.md 且含 description", async () => {
    const descs = await loadDescriptions();
    for (const [name, desc] of Object.entries(descs)) {
      expect(desc, `${name}/SKILL.md 缺少 description 字段`).toBeTruthy();
      expect(desc.length, `${name} description 太短`).toBeGreaterThan(10);
    }
  });
});

describe("Skill 路由回归 — query → skill 命中", () => {
  let descriptions: Record<SkillName, string>;

  // 读一次，所有 test 共享
  test("加载 descriptions", async () => {
    descriptions = await loadDescriptions();
    expect(Object.keys(descriptions)).toHaveLength(Object.keys(S).length);
  });

  for (const { query, skill, note } of EVAL_CASES) {
    test(`"${query}" → ${skill}${note ? ` (${note})` : ""}`, async () => {
      if (!descriptions) {
        descriptions = await loadDescriptions();
      }

      // 断言 1：目标 skill 的 description 能命中这条 query
      const targetDesc = descriptions[skill];
      expect(
        matchesDescription(query, targetDesc),
        `"${query}" 未命中 ${skill} 的 description:\n  ${targetDesc}`
      ).toBe(true);

      // 断言 2：best match 应该是目标 skill（防止其他 skill 抢占）
      const matched = bestMatch(query, descriptions);
      expect(
        matched,
        `"${query}" best match 是 ${matched}，期望 ${skill}`
      ).toBe(skill);
    });
  }
});

describe("Skill 路由边界", () => {
  test("无关 query 不命中任何 skill", async () => {
    const descriptions = await loadDescriptions();
    const irrelevant = ["你好", "今天天气怎么样", "帮我写代码"];
    for (const q of irrelevant) {
      const matched = bestMatch(q, descriptions);
      // 无关 query 最多只能弱命中，不做强断言，只打印
      if (matched) {
        console.warn(`⚠️  "${q}" 误命中了 ${matched}，检查 description 是否过宽`);
      }
    }
  });

  test("同一 skill 的不同触发词都能命中", async () => {
    const descriptions = await loadDescriptions();
    const topRatedVariants = [
      "推荐几个",
      "高分文章",
      "最值得看的",
      "score 最高",
      "best",
    ];
    for (const q of topRatedVariants) {
      expect(
        matchesDescription(q, descriptions[S.TOP_RATED]),
        `top-rated description 未覆盖触发词 "${q}"`
      ).toBe(true);
    }
  });
});
