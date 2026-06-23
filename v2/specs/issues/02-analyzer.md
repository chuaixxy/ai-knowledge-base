# Issue #02 · Analyzer Agent

> 源自 [AGENTS.md](../../AGENTS.md) · 依赖 #01

## Allowed Tools

- **Read** — 读取 `knowledge/raw/` 中的 raw 文件
- **Write** — 原地改写 raw 文件（追加分析字段）
- **WebFetch** — 可访问原文链接补充背景信息
- **Grep / Glob** — 查找 raw 文件

## What to build

读取 `knowledge/raw/` 中的原始采集数据，对未分析条目进行增量深度分析，生成中文技术摘要、综合评分、标签和分类，并标注目标读者与分析备注。分析结果原地追加到 raw 文件，状态从 `draft` 变更为 `review`。

## 分析维度（4 个）

| 维度 | 说明 |
|------|------|
| **技术摘要** | 生成中文技术摘要（`summary`），基于 `raw_description` 改写，直接切入核心，不用模板化开头 |
| **技术评分** | 综合 5 维度打分后得出一个总分（`score`，0-1，保留两位）。5 维度：实用价值 > 技术深度 > 时效性 > 社区热度 > 领域匹配 |
| **分类标签** | 提取标签（`tags`），三类：技术领域 / 应用场景 / 技术栈，英文小写连字符分隔；判定 `category` |
| **目标读者** | 标注 `audience`（研究者/工程师/产品经理/通用 等）和 `analysis_note`（分析备注） |

## Analyzer 在原采集数据上补充的字段

Analyzer 接收 Collector 的 `draft` 条目，原地追加以下字段：

| 追加字段 | 类型 | 说明 |
|----------|------|------|
| `summary` | `string` | 中文技术摘要（Collector 不生成，由 Analyzer 基于 `raw_description` 改写） |
| `tags` | `string[]` | 从空数组填充为三类标签，可超出预定义列表自定义添加 |
| `category` | `string` | 从 `null` 填充（ArXiv: `cs.XX`，其他: `tool`/`framework`/`paper`/`benchmark`/`tutorial`） |
| `score` | `number` | 综合评分（0-1，保留两位），5 维度加权后得出 |
| `audience` | `string` | 目标读者类型 |
| `analysis_note` | `string` | 分析备注，补充说明分析依据、亮点或注意事项 |
| `analyzed_at` | `string` | 从 `null` 填充为当前 ISO 8601 时间 |
| `status` | `string` | 从 `draft` 变更为 `review` |

### 分析后条目示例（对比采集阶段的变化）

```json
{
  "id": "github-trending-2026-06-23-001",
  "title": "openai/agents-sdk",
  "source": "github-trending",
  "source_id": "openai/agents-sdk",
  "source_url": "https://github.com/openai/agents-sdk",
  "author": "openai",
  "published_at": "2026-06-20T00:00:00Z",
  "raw_description": "The OpenAI Agents SDK is a lightweight yet powerful framework for building multi-agent workflows...",
  "summary": "OpenAI 官方发布的 Agent 开发 SDK，提供任务交接、工具调用与安全护栏等核心原语，支持多 Agent 编排与生产级部署。对 Agent 工程化落地有直接参考价值...",
  "tags": ["agent-framework", "multi-agent", "python", "openai"],
  "category": "tool",
  "score": 0.87,
  "audience": "工程师",
  "analysis_note": "OpenAI 官方出品，社区关注度极高。核心亮点在于 Guardrails 机制和任务交接原语，可直接集成到现有 Agent 系统中。",
  "collected_at": "2026-06-23T10:30:00Z",
  "analyzed_at": "2026-06-23T11:00:00Z",
  "organized_at": null,
  "status": "review"
}
```

## 技术评分标准（score）

**优先级**：实用价值 > 技术深度 > 时效性 > 社区热度 > 领域匹配

**权重**：实用价值 30% / 技术深度 25% / 时效性 15% / 社区热度 15% / 领域匹配 15%

| 维度 | 评分关注点 | 高分特征（0.8-1.0） | 低分特征（0-0.3） |
|------|-----------|---------------------|-------------------|
| 实用价值 | 能否直接用于工程实践、方案参考或能力建设 | 可立即落地的工具/SDK/框架，有清晰的工程指导意义 | 纯理论探讨，无工程化路径 |
| 技术深度 | 是否涉及架构、算法、机制或系统设计 | 有新的架构设计、算法创新、系统级方案，分析深入 | 浅层介绍，无实质技术内容 |
| 时效性 | 是否反映近期趋势、新发布能力或新方向 | 本周/本月新发布，反映当前最新方向 | 已发布超过半年且无持续更新 |
| 社区热度 | 是否具备一定关注度（stars、讨论度等） | GitHub stars >1000，HN 高讨论度，引用数高 | 几乎无关注，无人讨论 |
| 领域匹配 | 是否明确属于 AI/LLM/Agent 核心领域 | 直接涉及 LLM、Agent、RAG、MCP 等核心方向 | 仅沾边，主体不属 AI 领域 |

> **注意**：5 维度仅作为评分依据，最终输出只有一个 `score` 字段，不保留各维度分项值。

## Acceptance criteria

- [ ] 增量处理：仅处理 `relevance_score` 为 `null` 的条目，已分析条目保持不变
- [ ] 每个条目生成中文技术摘要，直接切入核心（是什么/为什么重要/关键技术点），不模板化
- [ ] `score` 综合评分 0-1，保留两位小数，按权重（30%/25%/15%/15%/15%）计算
- [ ] 标签为英文小写连字符格式，覆盖技术领域/应用场景/技术栈三类，可自定义添加
- [ ] ArXiv 条目 category 使用原生 `cs.XX` 分类
- [ ] GitHub/HN 条目 category 从 tags 推断（tool/framework/paper/benchmark/tutorial）
- [ ] `audience` 准确标注目标读者类型
- [ ] `analysis_note` 补充分析依据、亮点或注意事项
- [ ] 分析结果原地追加到 raw 文件对应条目，已分析条目字段不变
- [ ] 分析完成后 status 更新为 `review`，`analyzed_at` 设置为当前时间
- [ ] 客观中立，基于事实，不夸大，不编造
- [ ] 中文自然流畅，不用翻译腔

## Notes

- 增量判断依据为 `relevance_score` 是否为 `null`，不是 `status` 字段
- `summary` 基于 `raw_description` 改写成中文技术摘要，不保留原文
- `category` 对 ArXiv 必须直接取原生 `cs.XX`，不可自行推断
- `analysis_note` 用于记录分数依据、项目亮点、潜在风险等，辅助后续人工复核
- 标签可超出预定义列表，如遇到新兴领域可合理自定义

## Blocked by

- #01 — 需要 raw 文件中有已采集的 `draft` 条目作为输入
