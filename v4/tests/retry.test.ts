/**
 * withRetry 高阶函数测试
 */

import { describe, test, expect, vi } from "vitest";
import { withRetry } from "../distribution/retry.ts";

describe("withRetry", () => {
  test("首次成功不重试", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("shouldRetry 为真时退避重试直至成功", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      shouldRetry: (v) => !v.ok,
    });

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("重试用尽后返回最后一次结果", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false });

    const result = await withRetry(fn, {
      maxAttempts: 2,
      baseDelayMs: 1,
      shouldRetry: (v) => !v.ok,
    });

    expect(result).toEqual({ ok: false });
    expect(fn).toHaveBeenCalledTimes(3); // 1 次首次 + 2 次重试
  });

  test("网络异常退避后成功", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("异常重试用尽后抛出", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 })
    ).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("shouldRetryOnError 为 false 时不重试异常", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        shouldRetryOnError: () => false,
      })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
