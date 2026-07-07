/**
 * 异步退避重试高阶函数（类似 Python tenacity，函数式用法）。
 *
 * @example
 * await withRetry(() => fetchData(), {
 *   maxAttempts: 3,
 *   shouldRetry: (res) => res.status === 429,
 * });
 */

/** 退避重试配置。 */
export interface RetryOptions<T> {
  /** 最大重试次数（不含首次调用）。默认 3 → 最多共 4 次。 */
  maxAttempts?: number;
  /** 退避基数（毫秒），第 n 次重试前等待 baseDelayMs * 2^n。 */
  baseDelayMs?: number;
  /** 对返回值判断是否需要重试。 */
  shouldRetry?: (value: T, attempt: number) => boolean;
  /** 对异常判断是否需要重试；默认 true。 */
  shouldRetryOnError?: (error: unknown, attempt: number) => boolean;
}

/** 等待指定毫秒。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行 fn，失败时按指数退避重试。
 *
 * - `shouldRetry`：结果为真且未用尽次数 → 重试
 * - `shouldRetryOnError`：抛错且未用尽次数 → 重试
 * - 重试用尽仍失败 → 抛出最后一次异常
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions<T> = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    shouldRetry = () => false,
    shouldRetryOnError = () => true,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      if (shouldRetry(value, attempt) && attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return value;
    } catch (err) {
      lastError = err;
      if (shouldRetryOnError(err, attempt) && attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("重试次数已用尽");
}
