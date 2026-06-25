#!/usr/bin/env tsx

/**
 * 统一 LLM 调用客户端。
 *
 * 支持 DeepSeek / Qwen / OpenAI 三种模型提供商，通过 OpenAI 兼容 API 调用。
 * 提供带重试的 chatWithTry()、Token 估算、成本计算和 quickChat() 便捷函数。
 *
 * 环境变量：
 *   LLM_PROVIDER  - 模型提供商: deepseek (默认) / qwen / openai
 *   LLM_MODEL     - 模型名称，留空则使用各提供商默认模型
 *   API_KEY       - API 密钥，留空则按 LLM_PROVIDER 查找对应 *_API_KEY
 *   LLM_TIMEOUT   - 请求超时秒数 (默认 60)
 *   LLM_MAX_RETRIES - 最大重试次数 (默认 3)
 *   LLM_DEBUG     - 设为 1 开启 debug 日志
 */

import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// .env 自动加载：从 CWD 向上查找 .env 文件
(function loadDotEnv(): void {
  const cwd = process.cwd();
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env 读取失败不阻塞
  }
})();

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const isDebug = process.env.LLM_DEBUG === "1";

const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (isDebug) console.debug(`[LLM:DEBUG] ${msg}`, ...args);
  },
  info(msg: string, ...args: unknown[]): void {
    console.info(`[LLM:INFO] ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[LLM:WARN] ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    console.error(`[LLM:ERROR] ${msg}`, ...args);
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Token 用量统计。 */
interface Usage {
  /** 输入 token 数。 */
  prompt_tokens: number;
  /** 输出 token 数。 */
  completion_tokens: number;
  /** 总 token 数。 */
  total_tokens: number;
}

/** LLM 统一响应格式。 */
interface LLMResponse {
  /** 模型返回的文本内容。 */
  content: string;
  /** Token 用量统计，API 未返回时为 null。 */
  usage: Usage | null;
  /** 实际使用的模型名称。 */
  model: string;
  /** 结束原因，如 "stop" / "length" / "tool_calls" 等。 */
  finish_reason: string | null;
}

/** OpenAI 兼容 API 的消息格式。 */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** chat() 方法的可选参数。 */
interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

/** 提供商配置。 */
interface ProviderConfig {
  name: string;
  apiBase: string;
  apiKeyEnv: string;
  defaultModel: string;
}

/** 模型定价档位（USD / 1K tokens，匹配 Python 版 PRICING）。 */
interface PricingTier {
  /** 每千输入 token 价格。 */
  input: number;
  /** 每千输出 token 价格。 */
  output: number;
}

// ---------------------------------------------------------------------------
// Provider Configurations
// ---------------------------------------------------------------------------

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: {
    name: "DeepSeek",
    apiBase: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
  qwen: {
    name: "Qwen (Tongyi)",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "QWEN_API_KEY",
    defaultModel: "qwen-turbo-latest",
  },
  openai: {
    name: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
};

/**
 * 按模型名索引的定价表（USD / 1K tokens）。
 *
 * 当 estimateCost 查询不到某个模型的定价时，
 * 回退到当前提供商的默认模型定价；仍找不到则按默认价格。
 */
const MODEL_PRICING: Record<string, PricingTier> = {
  // DeepSeek
  "deepseek-chat": { input: 0.0014, output: 0.0028 },
  "deepseek-reasoner": { input: 0.004, output: 0.016 },

  // Qwen (Tongyi)
  "qwen-plus": { input: 0.002, output: 0.006 },
  "qwen-turbo": { input: 0.0005, output: 0.001 },

  // OpenAI
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
};

/** Usage 对象转普通字典。 */
function usageToDict(u: Usage): Record<string, number> {
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
  };
}

/** LLMResponse 对象转普通字典。 */
function responseToDict(r: LLMResponse): Record<string, unknown> {
  return {
    content: r.content,
    usage: r.usage ? usageToDict(r.usage) : null,
    model: r.model,
    finish_reason: r.finish_reason,
  };
}

/**
 * 估算单次调用成本（USD），按模型名查询 PRICING。
 *
 * 与 Python 版 estimate_cost 行为一致：按 1K tokens 单价 × 实际用量计算。
 *
 * Args:
 *   model: 模型名称。
 *   usage: Token 用量统计。
 *
 * Returns:
 *   成本金额（USD）。
 */
function estimateCost(model: string, usage: Usage): number {
  const fallback = { input: 0.002, output: 0.006 };
  const prices = MODEL_PRICING[model] ?? fallback;
  return (
    (usage.prompt_tokens / 1000) * prices.input +
    (usage.completion_tokens / 1000) * prices.output
  );
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * 判断字符是否为 CJK 字符（中文、日文、韩文）。
 *
 * CJK 字符在多数 tokenizer 下约占 1-2 个 token/字，
 * 而英文单词约占 1-2 个 token（约 4 个字符/token）。
 */
function isCJK(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0xac00 && code <= 0xd7af) || // Hangul
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0xff00 && code <= 0xffef)    // Fullwidth Forms
  );
}

/**
 * 使用启发式算法估算文本的 token 数量。
 *
 * 规则：
 *   - CJK 字符约 1.5 字符/token
 *   - 非 CJK 字符约 4.0 字符/token（英文单词平均）
 *
 * 该方法为近似估算，不依赖 tiktoken 等分词库，误差约 ±30%。
 *
 * Args:
 *   text: 输入文本。
 *
 * Returns:
 *   估算的 token 数（整数）。
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkCount = 0;
  let asciiCount = 0;

  for (const ch of text) {
    if (isCJK(ch)) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }

  // CJK: ~1.5 chars per token; ASCII: ~4 chars per token
  const tokens = cjkCount / 1.2 + asciiCount / 4.0;
  return Math.ceil(tokens);
}

// ---------------------------------------------------------------------------
// Abstract LLMProvider
// ---------------------------------------------------------------------------

/**
 * LLM 调用抽象基类。
 *
 * 所有模型提供商必须实现此接口的 chat() 方法。
 */
abstract class LLMProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * 发送对话请求并返回模型响应。
   *
   * Args:
   *   messages: 对话消息列表。
   *   options: 可选参数（模型、温度、最大 token）。
   *
   * Returns:
   *   包含内容和用量统计的 LLMResponse。
   */
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

/**
 * OpenAI 兼容 API 提供商实现。
 *
 * 通过 HTTP POST 调用 /chat/completions 端点，
 * 兼容 DeepSeek、Qwen、OpenAI 等使用 OpenAI 接口规范的 API。
 */
class OpenAICompatibleProvider extends LLMProvider {
  private apiKey: string;

  constructor(config: ProviderConfig, apiKey?: string) {
    super(config);
    // 优先级: 参数 > 统一 API_KEY > 提供商专属环境变量
    this.apiKey =
      apiKey ||
      process.env["API_KEY"] ||
      process.env[config.apiKeyEnv] ||
      "";
    if (!this.apiKey) {
      logger.warn(
        `未设置 API_KEY 或 ${config.apiKeyEnv}，请求可能被拒绝。`,
      );
    }
  }

  /**
   * 调用 OpenAI 兼容 API 发送对话请求。
   *
   * Args:
   *   messages: 对话消息列表。
   *   options: 可选参数。
   *   signal: AbortSignal 用于超时控制。
   *
   * Returns:
   *   LLMResponse。
   *
   * Raises:
   *   Error: 当 API 返回非 2xx 状态码或响应格式异常时。
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const model = options?.model || this.config.defaultModel;
    const url = `${this.config.apiBase}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
    };
    if (options?.max_tokens !== undefined) {
      body.max_tokens = options.max_tokens;
    }

    logger.debug(`请求 ${this.config.name} (${model})...`);
    logger.debug(`URL: ${url}`);
    logger.debug(`Messages: ${JSON.stringify(messages).slice(0, 200)}`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(响应体无法读取)");
      throw new Error(
        `${this.config.name} API 返回 HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    // 解析 OpenAI 兼容响应格式
    const choices = data["choices"] as
      | Array<{
          message?: { content?: string };
          finish_reason?: string;
        }>
      | undefined;

    if (!choices || choices.length === 0) {
      throw new Error(
        `${this.config.name} 响应无有效 choices: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const content = choices[0]?.message?.content || "";
    const finishReason = choices[0]?.finish_reason ?? null;

    let usage: Usage | null = null;
    const rawUsage = data["usage"] as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    if (rawUsage) {
      usage = {
        prompt_tokens: rawUsage.prompt_tokens ?? 0,
        completion_tokens: rawUsage.completion_tokens ?? 0,
        total_tokens: rawUsage.total_tokens ?? 0,
      };
    }

    return {
      content,
      usage,
      model: (data["model"] as string) || model,
      finish_reason: finishReason,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

let cachedProvider: LLMProvider | null = null;

/**
 * 根据环境变量获取或创建 LLM 提供商实例（带缓存）。
 *
 * 优先级：
 *   1. LLM_PROVIDER 环境变量（默认 "deepseek"）
 *   2. apiKeyOverride 参数覆盖
 *   3. 按 LLM_PROVIDER 查找对应 *_API_KEY 环境变量
 *
 * Args:
 *   apiKeyOverride: 可选，强制使用的 API 密钥。
 *
 * Returns:
 *   LLMProvider 实例。
 */
function getProvider(apiKeyOverride?: string): LLMProvider {
  if (cachedProvider && !apiKeyOverride) {
    return cachedProvider;
  }

  const providerKey = (process.env["LLM_PROVIDER"] || "deepseek").toLowerCase();
  const config = PROVIDER_CONFIGS[providerKey];

  if (!config) {
    const available = Object.keys(PROVIDER_CONFIGS).join(" / ");
    throw new Error(
      `不支持的提供商 '${providerKey}'，可选: ${available}`,
    );
  }

  const provider = new OpenAICompatibleProvider(config, apiKeyOverride);
  if (!apiKeyOverride) {
    cachedProvider = provider;
  }
  return provider;
}

// ---------------------------------------------------------------------------
// Retry & Timeout
// ---------------------------------------------------------------------------

/**
 * 带重试和超时的 LLM 对话函数。
 *
 * 使用指数退避策略，默认最多重试 3 次、单次请求超时 60 秒。
 * 仅在服务器错误（5xx）或网络错误时重试；客户端错误（4xx）不重试。
 *
 * Args:
 *   messages: 对话消息列表。
 *   options: 可选参数，可额外传入 timeout(ms) 和 maxRetries。
 *   provider: 可选，外部传入的 LLMProvider（不传则自动创建）。
 *
 * Returns:
 *   LLMResponse。
 *
 * Raises:
 *   Error: 当所有重试耗尽后仍然失败。
 */
async function chatWithTry(
  messages: ChatMessage[],
  options?: ChatOptions & { timeout?: number; maxRetries?: number },
  provider?: LLMProvider,
): Promise<LLMResponse> {
  const maxRetries = options?.maxRetries ?? parseInt(process.env["LLM_MAX_RETRIES"] || "3", 10);
  const timeoutMs =
    options?.timeout ??
    parseInt(process.env["LLM_TIMEOUT"] || "60", 10) * 1000;

  const llm = provider ?? getProvider();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      logger.debug(
        `第 ${attempt + 1}/${maxRetries} 次尝试 (timeout: ${timeoutMs}ms)...`,
      );

      const response = await llm.chat(messages, options, controller.signal);
      clearTimeout(timer);

      if (response.usage) {
        logger.debug(
          `Token 用量: ${response.usage.prompt_tokens} in / ${response.usage.completion_tokens} out / ${response.usage.total_tokens} total`,
        );
      }
      return response;
    } catch (error) {
      clearTimeout(timer);

      const err = error instanceof Error ? error : new Error(String(error));

      // 判断是否可重试：5xx 服务端错误、网络错误、超时
      const isRetryable =
        err.message.includes("503") ||
        err.message.includes("502") ||
        err.message.includes("504") ||
        err.message.includes("429") ||
        err.name === "AbortError" ||
        err.message.includes("fetch") ||
        err.message.includes("network") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ETIMEDOUT") ||
        err.message.includes("ECONNRESET");

      if (!isRetryable) {
        logger.error(`不可重试的错误: ${err.message}`);
        throw err;
      }

      lastError = err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
      logger.warn(
        `第 ${attempt + 1} 次失败 (${err.message.slice(0, 80)})，${(delay / 1000).toFixed(1)}s 后重试...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(
    `chatWithTry 重试 ${maxRetries} 次后仍失败: ${lastError?.message}`,
  );
}

// ---------------------------------------------------------------------------
// Cost Calculation
// ---------------------------------------------------------------------------

/**
 * 根据 API 返回的实际模型名查询定价，计算调用成本（USD）。
 *
 * 委托 estimateCost() 按模型名查询 PRICING。
 * 若 API 未返回 usage，则使用启发式 token 估算补位。
 *
 * Args:
 *   response: LLMResponse 对象。
 *   inputMessages: 在 API 无 usage 时用于估算输入 token。
 *
 * Returns:
 *   包含输入成本、输出成本和总计的对象。
 */
function calcCost(
  response: LLMResponse,
  inputMessages?: ChatMessage[],
): { inputCost: number; outputCost: number; totalCost: number } {
  let usage: Usage;

  if (response.usage) {
    usage = response.usage;
  } else {
    // 启发式估算
    const inputTokens = inputMessages
      ? inputMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
      : estimateTokens(response.content);
    const outputTokens = estimateTokens(response.content);
    usage = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    };
    logger.debug("API 未返回 usage，使用启发式估算 token 数。");
  }

  const totalCost = estimateCost(response.model, usage);
  const prices = MODEL_PRICING[response.model] ?? { input: 0.002, output: 0.006 };
  const inputCost = (usage.prompt_tokens / 1000) * prices.input;
  const outputCost = (usage.completion_tokens / 1000) * prices.output;

  return { inputCost, outputCost, totalCost };
}

// ---------------------------------------------------------------------------
// quickChat
// ---------------------------------------------------------------------------

/**
 * 便捷函数：一句话调用 LLM 并返回文本内容。
 *
 * 适合简单问答场景，自动使用默认模型和配置，自动重试。
 *
 * Args:
 *   prompt: 用户提示词。
 *   systemPrompt: 可选，系统提示词。
 *   options: 可选，覆盖默认参数。
 *
 * Returns:
 *   模型返回的文本内容。
 *
 * Raises:
 *   Error: 调用失败时抛出。
 *
 * Example:
 *   const answer = await quickChat("什么是 Transformer？");
 *   console.log(answer);
 */
async function quickChat(
  prompt: string,
  systemPrompt?: string,
  options?: ChatOptions,
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await chatWithTry(messages, options);
  return response.content;
}

/**
 * 便捷调用 LLM，返回包含 content 和 usage 的字典。
 *
 * 与 Python 版 chat() 行为一致：返回 content + usage 结构化字典。
 *
 * Args:
 *   prompt: 用户提示词。
 *   system: 系统提示词，默认 "你是一个 AI 技术分析助手。"。
 *   providerName: 提供商名称（deepseek/qwen/openai），默认读环境变量。
 *   maxRetries: 最大重试次数，默认 3。
 *
 * Returns:
 *   { content: string, usage: { prompt_tokens: number, ... } }
 *
 * Raises:
 *   Error: 调用失败时抛出。
 */
async function chat(
  prompt: string,
  system: string = "你是一个 AI 技术分析助手。",
  providerName?: string,
  maxRetries: number = 3,
): Promise<{ content: string; usage: Record<string, number> }> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  if (providerName) {
    process.env["LLM_PROVIDER"] = providerName;
  }

  const llm = getProvider();
  try {
    const response = await chatWithTry(messages, { maxRetries }, llm);
    const cost = estimateCost(response.model, response.usage!);
    logger.info(
      "Token 用量: %d (prompt) + %d (completion) = %d, 估算成本: $%.6f",
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0,
      response.usage?.total_tokens ?? 0,
      cost,
    );
    return {
      content: response.content,
      usage: response.usage ? usageToDict(response.usage) : usageToDict({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
    };
  } finally {
    // 不缓存 providerName 切换时的实例
  }
}

// ---------------------------------------------------------------------------
// ---- Main (test entry) ----
// ---------------------------------------------------------------------------

/**
 * 测试入口：当直接运行本脚本时执行简单的调用验证。
 *
 * 用法：
 *   LLM_PROVIDER=deepseek API_KEY=sk-xxx tsx pipeline/model-client.ts
 */
async function main(): Promise<void> {
  const provider = getProvider();
  logger.info(
    `当前提供商: ${provider.config.name} (${provider.config.defaultModel})`,
  );

  // 简单调用测试
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: "你是一个简洁的助手，用中文回答。" },
      { role: "user", content: "一句话解释什么是 Prompt Engineering。" },
    ];

    logger.info("发送测试请求...");
    const response = await chatWithTry(messages, {
      temperature: 0.1,
      max_tokens: 200,
    });

    logger.info(`模型: ${response.model}`);
    logger.info(`结束原因: ${response.finish_reason}`);
    logger.info(`回复: ${response.content}`);

    if (response.usage) {
      logger.info(
        `Token: ${response.usage.prompt_tokens} in / ${response.usage.completion_tokens} out / ${response.usage.total_tokens} total`,
      );
    }

    const cost = calcCost(response, messages);
    logger.info(
      `估算成本: 输入 $${cost.inputCost.toFixed(6)} / 输出 $${cost.outputCost.toFixed(6)} / 总计 $${cost.totalCost.toFixed(6)}`,
    );

    // 测试 quickChat
    logger.info("\n测试 quickChat...");
    const quickResult = await quickChat("用三个词描述人工智能。");
    logger.info(`quickChat 回复: ${quickResult}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`测试失败: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error(`未捕获异常: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  // Types
  type Usage,
  type LLMResponse,
  type ChatMessage,
  type ChatOptions,
  type ProviderConfig,
  type PricingTier,

  // Classes
  LLMProvider,
  OpenAICompatibleProvider,

  // Functions
  getProvider,
  chatWithTry,
  calcCost,
  estimateCost,
  estimateTokens,
  quickChat,
  chat,
  usageToDict,
  responseToDict,

  // Config
  PROVIDER_CONFIGS,
  MODEL_PRICING,
};
