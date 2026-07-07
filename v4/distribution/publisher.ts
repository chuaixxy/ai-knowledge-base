/**
 * distribution/publisher.ts
 *
 * 日报推送层：将每日摘要发送至外部渠道。
 *
 * ## 飞书 Webhook 环境变量
 *
 * | 变量 | 必需 | 说明 |
 * |------|------|------|
 * | FEISHU_WEBHOOK_URL | 是 | 群自定义机器人 Webhook 地址 |
 * | FEISHU_WEBHOOK_SECRET | 否 | 签名校验密钥（机器人在飞书侧开启「签名校验」时填写） |
 * | FEISHU_KEYWORD | 否 | 自定义关键词（机器人开启「自定义关键词」时，会写入卡片 title） |
 *
 * ## 飞书官方限制
 *
 * - 频率：5 次/秒、100 次/分钟（本模块卡片间隔 250ms，限流时指数退避重试）
 * - 请求体：≤ 20 KB（发送前自动截断过长 summary）
 * - IP 白名单：在飞书机器人设置中配置，代码无需改动
 *
 * @see ./feishu-webhook.ts
 * @see https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */

import { generateDailyDigest } from "./formatter.js";
import {
  FEISHU_MAX_RETRIES,
  FEISHU_SEND_INTERVAL_MS,
  isFeishuRateLimited,
  prepareFeishuPayload,
} from "./feishu-webhook.js";

// ── 共享类型 ──────────────────────────────────────────────────────────────────

/** 从 generateDailyDigest 返回值推断，与 formatter 保持同步。 */
type DailyDigest = Awaited<ReturnType<typeof generateDailyDigest>>;

/** 原样转发给 generateDailyDigest 的选项。 */
type DigestOptions = NonNullable<Parameters<typeof generateDailyDigest>[0]>;

/** 单次发布操作的结果。 */
export interface PublishResult {
  /** 渠道标识，如 "feishu"。 */
  channel: string;
  /** 是否发布成功。 */
  success: boolean;
  /** 成功时平台返回的消息 ID（如有）。 */
  messageId?: string;
  /** 失败时的可读错误描述。 */
  error?: string;
}

/** 飞书 Webhook 可选安全配置。 */
export interface FeishuPublisherOptions {
  webhookUrl?: string;
  /** 签名校验密钥，默认读 FEISHU_WEBHOOK_SECRET */
  secret?: string;
  /** 自定义关键词，默认读 FEISHU_KEYWORD */
  keyword?: string;
}

type FeishuResponseData = {
  code?: number;
  StatusCode?: number;
  msg?: string;
};

// ── BasePublisher ─────────────────────────────────────────────────────────────

/**
 * 所有渠道发布器的抽象基类。
 *
 * 子类须实现：
 *  - {@link sendMessage} — 发送纯文本消息
 *  - {@link sendDigest}  — 发送结构化日报
 */
export abstract class BasePublisher {
  /** 稳定渠道名，用于每条 {@link PublishResult}。 */
  abstract readonly channel: string;

  /**
   * 向该渠道发送纯文本消息。
   * @param text - 消息正文。
   */
  abstract sendMessage(text: string): Promise<PublishResult>;

  /**
   * 向该渠道发送格式化日报。
   * @param digest - 由 generateDailyDigest() 生成的日报对象。
   */
  abstract sendDigest(digest: DailyDigest): Promise<PublishResult[]>;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 等待指定毫秒（用于 Webhook 限流间隔 / 退避重试）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 通过 AbortController 发起 JSON POST，硬超时 30 秒。 */
async function postJson(url: string, body: unknown): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 将飞书 Webhook 响应规范为统一结果结构。 */
function feishuResult(
  channel: string,
  httpStatus: number,
  data: FeishuResponseData
): PublishResult {
  // 飞书 v1 用 StatusCode，v2 用 code；均为 0 表示成功。
  const code = data.code ?? data.StatusCode ?? -1;
  if (httpStatus < 200 || httpStatus >= 300 || code !== 0) {
    return { channel, success: false, error: data.msg ?? `HTTP ${httpStatus}` };
  }
  return { channel, success: true };
}

// ── FeishuPublisher ───────────────────────────────────────────────────────────

/**
 * 通过 Incoming Webhook 向飞书群发送消息。
 *
 * 必需：`FEISHU_WEBHOOK_URL`
 * 可选：`FEISHU_WEBHOOK_SECRET`（签名校验）、`FEISHU_KEYWORD`（关键词校验）
 */
export class FeishuPublisher extends BasePublisher {
  readonly channel = "feishu";
  private readonly webhookUrl: string;
  private readonly secret?: string;
  private readonly keyword?: string;

  constructor(opts: FeishuPublisherOptions = {}) {
    super();
    const url = opts.webhookUrl ?? process.env.FEISHU_WEBHOOK_URL;
    if (!url) throw new Error("FEISHU_WEBHOOK_URL is not set");
    this.webhookUrl = url;
    this.secret = opts.secret ?? process.env.FEISHU_WEBHOOK_SECRET;
    this.keyword = opts.keyword ?? process.env.FEISHU_KEYWORD;
  }

  /** 发送单条载荷，限流时指数退避重试。 */
  private async postFeishu(payload: Record<string, unknown>): Promise<PublishResult> {
    for (let attempt = 0; attempt <= FEISHU_MAX_RETRIES; attempt++) {
      try {
        const body = prepareFeishuPayload(payload, {
          keyword: this.keyword,
          secret: this.secret,
        });
        const res = await postJson(this.webhookUrl, body);
        const data = (await res.json()) as FeishuResponseData;
        const result = feishuResult(this.channel, res.status, data);

        if (
          !result.success &&
          isFeishuRateLimited(res.status, data) &&
          attempt < FEISHU_MAX_RETRIES
        ) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return result;
      } catch (err) {
        if (attempt < FEISHU_MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return { channel: this.channel, success: false, error: String(err) };
      }
    }
    return { channel: this.channel, success: false, error: "重试次数已用尽" };
  }

  /**
   * 向飞书群发送纯文本消息。
   * @param text - 消息内容。
   */
  async sendMessage(text: string): Promise<PublishResult> {
    return this.postFeishu({ msg_type: "text", content: { text } });
  }

  /**
   * 顺序发送日报卡片。
   *
   * 卡片逐条发送（非并发），间隔 {@link FEISHU_SEND_INTERVAL_MS} ms；
   * 触发限流时自动指数退避重试。
   *
   * @param digest - 日报；digest.feishu 为预构建的卡片载荷。
   * @returns 每张卡片对应一条 PublishResult。
   */
  async sendDigest(digest: DailyDigest): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (let i = 0; i < digest.feishu.length; i++) {
      const card = digest.feishu[i] as Record<string, unknown>;
      results.push(await this.postFeishu(card));
      if (i < digest.feishu.length - 1) await sleep(FEISHU_SEND_INTERVAL_MS);
    }
    return results;
  }
}

// ── publishDailyDigest ────────────────────────────────────────────────────────

/** {@link publishDailyDigest} 接受的选项。 */
export interface PublishOptions extends DigestOptions {
  /**
   * 显式指定发布器列表。默认使用所有已配置必需环境变量的发布器。
   */
  publishers?: BasePublisher[];
}

/**
 * 统一入口：生成当日日报并发布到所有渠道。
 *
 * 按环境变量自动检测的渠道：
 * - `FEISHU_WEBHOOK_URL` → {@link FeishuPublisher}
 *
 * 各渠道并发执行；渠道内卡片顺序发送。
 *
 * @param opts - 可选的日报生成参数与发布器覆盖。
 * @returns 所有渠道 {@link PublishResult} 的扁平数组。
 */
export async function publishDailyDigest(
  opts: PublishOptions = {}
): Promise<PublishResult[]> {
  const { publishers, ...digestOpts } = opts;

  const digest = await generateDailyDigest(digestOpts);

  const active: BasePublisher[] = publishers ?? detectPublishers();

  if (active.length === 0) {
    console.warn(
      "[publisher] 未配置推送渠道 — 请设置 FEISHU_WEBHOOK_URL"
    );
    return [];
  }

  const batches = await Promise.all(active.map((p) => p.sendDigest(digest)));
  return batches.flat();
}

/** 为每个已设置的环境变量构建对应发布器实例。 */
function detectPublishers(): BasePublisher[] {
  const list: BasePublisher[] = [];
  if (process.env.FEISHU_WEBHOOK_URL) list.push(new FeishuPublisher());
  return list;
}
