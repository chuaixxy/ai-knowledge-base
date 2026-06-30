/**
 * 验证 Security PII 掩码 — 对应 Python filter_output 示例
 * 运行：npx tsx tests/verify-pii.ts
 */

import { filterOutput } from "./security.ts";

const text =
  "联系作者 13812345678 或 author@example.com 获取完整代码 · IP 192.168.1.1";

const [filtered, detections] = filterOutput(text, true);

console.log(`原文：${text}`);
console.log(`掩码：${filtered}`);
console.log(`检出：${JSON.stringify(detections)}`);

// 可选断言
const expected =
  "联系作者 [PHONE_CN_MASKED] 或 [EMAIL_MASKED] 获取完整代码 · IP [IP_ADDRESS_MASKED]";
if (filtered !== expected) {
  throw new Error(`掩码结果不符，实际：${filtered}`);
}
if (detections.length < 3) {
  throw new Error(`期望检出 3 类 PII，实际：${detections}`);
}

console.log("✅ PII 掩码验证通过");
