/**
 * Security 模块 — 输入清洗 + 输出过滤 + 速率限制 + 审计日志
 *
 * 生产 Agent 四道防线：防注入、防 PII 泄露、防滥用、可追溯。
 */

// ── 1. 输入清洗（防 Prompt 注入）────────────────────────────

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s*prompt\s*[:：]/i,
  /override\s+(the\s+)?(system|safety)/i,
  /jailbreak/i,
  /\bDAN\s+mode\b/i,
  /忽略(之前|上面|所有|先前)(的)?(指令|规则|提示)/,
  /你现在(是|扮演|变成)/,
  /无视(以上|之前|上面)(的)?(规则|指令|限制)/,
  /新(的)?指令[:：]/,
  /不要(再)?遵守(之前|上面)(的)?(规则|指令)/,
  /进入\s*开发者\s*模式/,
];

const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const MAX_INPUT_LENGTH = 10_000;

export function sanitizeInput(text: string): [string, string[]] {
  const warnings: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`可疑注入: ${pattern.source}`);
    }
  }

  let cleaned = text.replace(CONTROL_CHAR_PATTERN, "");

  if (cleaned.length > MAX_INPUT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_INPUT_LENGTH);
    warnings.push("输入超长已截断");
  }

  return [cleaned, warnings];
}

// ── 2. 输出过滤（PII 检测与掩码）────────────────────────────

export const PII_PATTERNS: Record<string, RegExp> = {
  phone_cn: /1[3-9]\d{9}/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  id_card_cn: /\d{17}[\dXx]|\d{15}/g,
  credit_card: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

function maskLabel(piiType: string): string {
  return `[${piiType.toUpperCase()}_MASKED]`;
}

export function filterOutput(
  text: string,
  mask = true,
): [string, string[]] {
  const detections: string[] = [];
  let filtered = text;

  for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    const matches = filtered.match(globalPattern);

    if (matches && matches.length > 0) {
      detections.push(`${piiType}: 检测到 ${matches.length} 处`);
      if (mask) {
        filtered = filtered.replace(globalPattern, maskLabel(piiType));
      }
    }
  }

  return [filtered, detections];
}

// ── 3. 速率限制（滑动窗口）──────────────────────────────────

export class RateLimiter {
  private readonly maxCalls: number;
  private readonly windowSeconds: number;
  private readonly calls = new Map<string, number[]>();

  constructor(maxCalls = 60, windowSeconds = 60) {
    this.maxCalls = maxCalls;
    this.windowSeconds = windowSeconds;
  }

  private prune(clientId: string, now: number): number[] {
    const cutoff = now - this.windowSeconds;
    const recent = (this.calls.get(clientId) ?? []).filter((t) => t > cutoff);
    this.calls.set(clientId, recent);
    return recent;
  }

  check(clientId = "default"): boolean {
    const now = Date.now() / 1000;
    const recent = this.prune(clientId, now);

    if (recent.length >= this.maxCalls) {
      return false;
    }

    recent.push(now);
    this.calls.set(clientId, recent);
    return true;
  }

  getRemaining(clientId = "default"): number {
    const now = Date.now() / 1000;
    const recent = this.prune(clientId, now);
    return Math.max(0, this.maxCalls - recent.length);
  }
}

// ── 4. 审计日志 ─────────────────────────────────────────────

export interface AuditEntry {
  timestamp: number;
  eventType: "input" | "output" | "security";
  details: Record<string, unknown>;
  warnings: string[];
}

export class AuditLogger {
  private readonly entries: AuditEntry[] = [];

  private log(
    eventType: AuditEntry["eventType"],
    details: Record<string, unknown> = {},
    warnings: string[] = [],
  ): void {
    this.entries.push({
      timestamp: Date.now() / 1000,
      eventType,
      details,
      warnings,
    });
  }

  logInput(text: string, warnings: string[] = []): void {
    this.log("input", { len: text.length }, warnings);
  }

  logOutput(text: string, pii: string[] = []): void {
    this.log(
      "output",
      { len: text.length, pii_detected: pii.length > 0 },
      pii,
    );
  }

  logSecurity(event: string, details: Record<string, unknown> = {}): void {
    this.log("security", { event, ...details });
  }

  getSummary(): {
    total_events: number;
    events_by_type: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};

    for (const entry of this.entries) {
      eventsByType[entry.eventType] = (eventsByType[entry.eventType] ?? 0) + 1;
    }

    return {
      total_events: this.entries.length,
      events_by_type: eventsByType,
    };
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

// ── 便捷集成函数 ─────────────────────────────────────────────

const defaultRateLimiter = new RateLimiter();

export function secureInput(
  text: string,
  clientId: string,
): { cleaned: string; warnings: string[]; allowed: boolean } {
  const [cleaned, warnings] = sanitizeInput(text);
  const allowed = defaultRateLimiter.check(clientId);

  if (!allowed) {
    warnings.push("请求被速率限制");
  }

  return { cleaned, warnings, allowed };
}

export function secureOutput(text: string): {
  filtered: string;
  detections: string[];
} {
  const [filtered, detections] = filterOutput(text);
  return { filtered, detections };
}
