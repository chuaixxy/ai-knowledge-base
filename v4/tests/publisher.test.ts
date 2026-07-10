/**
 * publisher 文件导出测试
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, test, expect } from "vitest";
import {
  FilePublisher,
  FeishuPublisher,
  publishFile,
} from "../distribution/publisher.ts";
import { buildEmptyFeishuCard } from "../distribution/formatter.ts";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "publisher-test-"));
  return tempDir;
}

describe("publishFile", () => {
  test("写入文件并返回路径", async () => {
    const dir = await makeTempDir();
    const result = await publishFile("# 日报\n\n内容", "digest-2026-07-01.md", dir);

    expect(result.success).toBe(true);
    expect(result.channel).toBe("file");
    expect(result.messageId).toBe(join(dir, "digest-2026-07-01.md"));

    const saved = await readFile(join(dir, "digest-2026-07-01.md"), "utf-8");
    expect(saved).toBe("# 日报\n\n内容");
  });

  test("自动创建 output 子目录", async () => {
    const dir = await makeTempDir();
    const nested = join(dir, "output");
    const result = await publishFile("hello", "test.md", nested);

    expect(result.success).toBe(true);
    const saved = await readFile(join(nested, "test.md"), "utf-8");
    expect(saved).toBe("hello");
  });
});

describe("FilePublisher", () => {
  test("sendDigest 写入 digest-YYYY-MM-DD.md", async () => {
    const dir = await makeTempDir();
    const pub = new FilePublisher({ outputDir: dir });
    const [result] = await pub.sendDigest({
      date: "2026-07-01",
      total: 3,
      articles: [],
      markdown: "# 知识库日报 2026-07-01",
      feishu: buildEmptyFeishuCard("2026-07-01"),
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(join(dir, "digest-2026-07-01.md"));

    const saved = await readFile(join(dir, "digest-2026-07-01.md"), "utf-8");
    expect(saved).toBe("# 知识库日报 2026-07-01");
  });
});

describe("FeishuPublisher", () => {
  test("sendDigest 只发送一条汇总卡片", async () => {
    const calls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch;

    try {
      const pub = new FeishuPublisher({
        webhookUrl: "https://example.com/hook",
      });
      const card = buildEmptyFeishuCard("2026-07-01");
      const results = await pub.sendDigest({
        date: "2026-07-01",
        total: 0,
        articles: [],
        markdown: "# empty",
        feishu: card,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
