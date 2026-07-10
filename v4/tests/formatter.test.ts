/**
 * formatter 分类桶测试 — 验证 CATEGORY_TO_BUCKET / TAG_TO_BUCKET 分桶逻辑
 */

import { describe, test, expect } from "vitest";
import {
  buildEmptyFeishuCard,
  buildFeishuDigest,
  groupByBucket,
  orderedBucketKeys,
  renderDigestMarkdown,
  type Article,
} from "../distribution/formatter.ts";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "2026-07-07-001",
    title: "Test Article",
    source: "test",
    url: "https://example.com",
    summary: "summary",
    tags: [],
    relevance_score: 0.8,
    category: "unknown",
    ...overrides,
  };
}

/** 断言单篇文章被分到指定 bucket */
function expectBucket(category: string, expected: string, tags: string[] = []) {
  const map = groupByBucket(
    [makeArticle({ category, tags, title: `${category} article` })],
    5
  );
  expect(map.has(expected)).toBe(true);
  expect(map.get(expected)!.some((a) => a.category === category)).toBe(true);
}

describe("CATEGORY_TO_BUCKET — 中文分类映射", () => {
  test.each([
    ["AI代理框架", "agent"],
    ["AI应用框架", "framework"],
    ["AI开发平台", "framework"],
    ["AI基础设施/工具", "tool"],
    ["AI基础设施/优化工具", "tool"],
    ["AI应用与工具", "tool"],
    ["模型微调框架", "fine-tuning"],
    ["开发工具与平台", "tool"],
    ["学习资源", "tutorial"],
    ["数据库技术", "tool"],
  ] as const)("category=%s → bucket=%s", (category, bucket) => {
    expectBucket(category, bucket);
  });
});

describe("CATEGORY_TO_BUCKET — 英文分类映射", () => {
  test.each([
    ["framework", "framework"],
    ["tool", "tool"],
    ["paper", "paper"],
    ["benchmark", "benchmark"],
    ["tutorial", "tutorial"],
  ] as const)("category=%s → bucket=%s", (category, bucket) => {
    expectBucket(category, bucket);
  });
});

describe("CATEGORY_TO_BUCKET — 边界与 fallback", () => {
  test("未知分类归入 other", () => {
    expectBucket("完全不认识的分类", "other");
  });

  test("空 category 归入 other", () => {
    expectBucket("", "other");
  });

  test("大小写不敏感", () => {
    expectBucket("AI应用框架", "framework");
    expectBucket("ai应用框架", "framework");
    expectBucket("FRAMEWORK", "framework");
  });
});

describe("TAG 优先于 CATEGORY", () => {
  test("有 tag 映射时忽略 category", () => {
    const map = groupByBucket(
      [
        makeArticle({
          category: "学习资源", // 本应 → tutorial
          tags: ["mcp"], // 应 → mcp
        }),
      ],
      5
    );
    expect(map.has("mcp")).toBe(true);
    expect(map.has("tutorial")).toBe(false);
  });

  test("无 tag 映射时才走 category", () => {
    const map = groupByBucket(
      [makeArticle({ category: "学习资源", tags: ["unknown-tag"] })],
      5
    );
    expect(map.has("tutorial")).toBe(true);
  });
});

describe("groupByBucket 集成行为", () => {
  test("同 bucket 内按 relevance_score 降序，并受 topN 限制", () => {
    const articles = [
      makeArticle({ title: "low", category: "tool", relevance_score: 0.5 }),
      makeArticle({ title: "high", category: "tool", relevance_score: 0.9 }),
      makeArticle({ title: "mid", category: "tool", relevance_score: 0.7 }),
    ];
    const map = groupByBucket(articles, 2);
    const tool = map.get("tool")!;
    expect(tool).toHaveLength(2);
    expect(tool[0]!.title).toBe("high");
    expect(tool[1]!.title).toBe("mid");
  });

  test("orderedBucketKeys 按 BUCKET_PRIORITY 排序", () => {
    const map = groupByBucket(
      [
        makeArticle({ category: "paper" }),
        makeArticle({ category: "AI代理框架" }),
        makeArticle({ category: "unknown" }),
      ],
      5
    );
    const keys = orderedBucketKeys(map);
    expect(keys.indexOf("agent")).toBeLessThan(keys.indexOf("paper"));
    expect(keys).toContain("other");
  });

  test("renderDigestMarkdown 输出对应 bucket 标题", () => {
    const map = groupByBucket(
      [makeArticle({ category: "AI代理框架", title: "Agent 文章" })],
      5
    );
    const md = renderDigestMarkdown(
      "2026-07-07",
      1,
      map,
      orderedBucketKeys(map)
    );
    expect(md).toContain("## Agent");
    expect(md).toContain("Agent 文章");
  });
});

describe("buildFeishuDigest — 与 Python 一致的单卡片汇总", () => {
  test("多篇文章合并为一张卡片", () => {
    const articles = [
      makeArticle({ title: "Article A", relevance_score: 0.9, tags: ["mcp"] }),
      makeArticle({ title: "Article B", relevance_score: 0.7, tags: ["rag"] }),
    ];
    const card = buildFeishuDigest("2026-07-10", articles) as {
      msg_type: string;
      card: { elements: unknown[]; header: { title: { content: string } } };
    };

    expect(card.msg_type).toBe("interactive");
    expect(card.card.header.title.content).toContain("2026-07-10");
    expect(card.card.elements.length).toBeGreaterThan(2);
    expect(JSON.stringify(card)).toContain("Article A");
    expect(JSON.stringify(card)).toContain("Article B");
    expect(JSON.stringify(card)).toContain('"tag":"hr"');
  });

  test("无文章时返回空简报卡片", () => {
    const card = buildEmptyFeishuCard("2026-07-10") as {
      card: { header: { title: { content: string } } };
    };
    expect(card.card.header.title.content).toContain("📭");
  });
});
