/**
 * 飞书自定义机器人 Webhook 工具。
 *
 * 官方限制（单租户单机器人）：
 * - 频率：5 次/秒、100 次/分钟
 * - 请求体：≤ 20 KB
 * - 鉴权（可选）：自定义关键词 / IP 白名单 / 签名校验
 *
 * @see https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */

import { createHmac } from "node:crypto";

/** 飞书 Webhook 请求体上限 20 KB，编码时留 2 KB 余量。 */
export const FEISHU_MAX_BODY_BYTES = 18 * 1024;

/** 卡片发送间隔（毫秒），约 4 条/秒，低于 5 次/秒限制。 */
export const FEISHU_SEND_INTERVAL_MS = 250;

/** 触发限流时的最大重试次数。 */
export const FEISHU_MAX_RETRIES = 3;

type FeishuPayload = Record<string, unknown>;

interface MarkdownElement {
  tag: string;
  content?: string;
}

/** 计算飞书 Webhook 签名校验字段（HmacSHA256 + Base64，消息体为空串）。 */
export function feishuSign(secret: string, timestamp: string): string {
  const key = `${timestamp}\n${secret}`;
  return createHmac("sha256", key).update("").digest("base64");
}

/** 为请求体附加 timestamp / sign（机器人开启签名校验时使用）。 */
export function attachFeishuSign(
  payload: FeishuPayload,
  secret: string,
  timestamp = String(Math.floor(Date.now() / 1000))
): FeishuPayload {
  return {
    ...payload,
    timestamp,
    sign: feishuSign(secret, timestamp),
  };
}

/**
 * 在 title / text 中注入自定义关键词（机器人开启关键词校验时使用）。
 * 关键词仅对 text、title 类字段生效。
 */
export function applyFeishuKeyword(
  payload: FeishuPayload,
  keyword: string
): FeishuPayload {
  const clone = structuredClone(payload) as FeishuPayload;

  if (clone.msg_type === "text") {
    const content = clone.content as { text?: string } | undefined;
    if (content?.text && !content.text.includes(keyword)) {
      content.text = `${keyword} ${content.text}`;
    }
    return clone;
  }

  const card = clone.card as { header?: { title?: { content?: string } } } | undefined;
  const title = card?.header?.title?.content;
  if (title && !title.includes(keyword)) {
    card!.header!.title!.content = `${keyword} ${title}`;
  }
  return clone;
}

/** 截断卡片内 markdown 字段，使 JSON 序列化后不超过 maxBytes。 */
export function fitFeishuBodySize(
  payload: FeishuPayload,
  maxBytes = FEISHU_MAX_BODY_BYTES
): FeishuPayload {
  const clone = structuredClone(payload) as FeishuPayload;
  if (Buffer.byteLength(JSON.stringify(clone), "utf8") <= maxBytes) return clone;

  const card = clone.card as { body?: { elements?: MarkdownElement[] } } | undefined;
  const elements = card?.body?.elements;
  if (!elements?.length) return clone;

  const markdownEls = elements.filter(
    (el) => el.tag === "markdown" && typeof el.content === "string"
  );
  if (!markdownEls.length) return clone;

  const suffix = "…（已截断）";
  for (const el of markdownEls) {
    while (
      Buffer.byteLength(JSON.stringify(clone), "utf8") > maxBytes &&
      (el.content?.length ?? 0) > suffix.length + 20
    ) {
      el.content = el.content!.slice(0, el.content!.length - 200) + suffix;
    }
  }
  return clone;
}

/** 组装发送前的最终载荷：关键词 → 体积裁剪 → 签名。 */
export function prepareFeishuPayload(
  payload: FeishuPayload,
  opts: { keyword?: string; secret?: string } = {}
): FeishuPayload {
  let body = opts.keyword ? applyFeishuKeyword(payload, opts.keyword) : payload;
  body = fitFeishuBodySize(body);
  if (opts.secret) body = attachFeishuSign(body, opts.secret);
  return body;
}

/** 判断飞书响应是否因限流失败（需退避重试）。 */
export function isFeishuRateLimited(
  httpStatus: number,
  data: { code?: number; msg?: string }
): boolean {
  if (httpStatus === 429) return true;
  const msg = (data.msg ?? "").toLowerCase();
  return (
    data.code === 11232 ||
    msg.includes("too many") ||
    msg.includes("rate limit") ||
    msg.includes("频控") ||
    msg.includes("限流")
  );
}
