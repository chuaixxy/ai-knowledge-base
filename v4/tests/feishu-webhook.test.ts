/**
 * 飞书 Webhook 工具测试
 */

import { describe, test, expect } from "vitest";
import {
  FEISHU_MAX_BODY_BYTES,
  attachFeishuSign,
  applyFeishuKeyword,
  feishuSign,
  fitFeishuBodySize,
  isFeishuRateLimited,
  prepareFeishuPayload,
} from "../distribution/feishu-webhook.ts";

describe("feishuSign", () => {
  test("相同 timestamp + secret 产生稳定签名", () => {
    const a = feishuSign("test-secret", "1599360473");
    const b = feishuSign("test-secret", "1599360473");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("attachFeishuSign", () => {
  test("附加 timestamp 与 sign 字段", () => {
    const out = attachFeishuSign({ msg_type: "text" }, "secret", "1234567890");
    expect(out.timestamp).toBe("1234567890");
    expect(typeof out.sign).toBe("string");
  });
});

describe("applyFeishuKeyword", () => {
  test("text 消息注入关键词", () => {
    const out = applyFeishuKeyword(
      { msg_type: "text", content: { text: "hello" } },
      "日报"
    );
    expect((out.content as { text: string }).text).toContain("日报");
  });

  test("interactive 卡片 title 注入关键词", () => {
    const out = applyFeishuKeyword(
      {
        msg_type: "interactive",
        card: { header: { title: { content: "标题" } } },
      },
      "知识库"
    );
    expect(
      (out.card as { header: { title: { content: string } } }).header.title
        .content
    ).toContain("知识库");
  });

  test("已含关键词时不重复注入", () => {
    const out = applyFeishuKeyword(
      { msg_type: "text", content: { text: "日报内容" } },
      "日报"
    );
    expect((out.content as { text: string }).text).toBe("日报内容");
  });
});

describe("fitFeishuBodySize", () => {
  test("小载荷不截断", () => {
    const payload = { msg_type: "text", content: { text: "短" } };
    expect(fitFeishuBodySize(payload)).toEqual(payload);
  });

  test("超大 summary 会被截断", () => {
    const payload = {
      msg_type: "interactive",
      card: {
        body: {
          elements: [{ tag: "markdown", content: "x".repeat(30_000) }],
        },
      },
    };
    const out = fitFeishuBodySize(payload, FEISHU_MAX_BODY_BYTES);
    const size = Buffer.byteLength(JSON.stringify(out), "utf8");
    expect(size).toBeLessThanOrEqual(FEISHU_MAX_BODY_BYTES);
    expect(
      (out.card as { body: { elements: { content: string }[] } }).body
        .elements[0]!.content
    ).toContain("已截断");
  });
});

describe("prepareFeishuPayload", () => {
  test("组合关键词 + 签名", () => {
    const out = prepareFeishuPayload(
      { msg_type: "text", content: { text: "test" } },
      { keyword: "日报", secret: "sec" }
    );
    expect((out.content as { text: string }).text).toContain("日报");
    expect(out.timestamp).toBeDefined();
    expect(out.sign).toBeDefined();
  });
});

describe("isFeishuRateLimited", () => {
  test("识别 HTTP 429", () => {
    expect(isFeishuRateLimited(429, {})).toBe(true);
  });

  test("识别 too many request 文案", () => {
    expect(isFeishuRateLimited(200, { msg: "too many request" })).toBe(true);
  });

  test("成功响应不算限流", () => {
    expect(isFeishuRateLimited(200, { code: 0, msg: "success" })).toBe(false);
  });
});
