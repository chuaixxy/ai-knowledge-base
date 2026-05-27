---
name: tech-summary
description: 当需要对采集的技术内容进行深度分析总结时使用此技能
allowed-tools: Read, Grep, Glob, WebFetch
---

# 技术内容深度分析技能

## 使用场景

本技能适用于以下场景：

- 对 `knowledge/raw/` 中采集的原始内容进行批量深度分析
- 生成精简摘要、提取技术亮点、执行量化评分
- 识别批次内容中的技术趋势与新兴概念
- 为知识库筛选高价值内容并生成结构化草稿

## 执行步骤

### 步骤 1：读取最新采集文件

使用 Glob 查找 `knowledge/raw/` 目录下最新的采集文件（如 `github_trending_YYYY-MM-DD.json`）。

- 按文件名日期排序，取最近一个文件
- 使用 Read 读取文件内容，确认 `items` 数组及原始字段完整性
- 若文件缺失或格式异常，记录错误并中断任务

### 步骤 2：逐条深度分析

对 `items` 中的每条内容执行以下分析：

| 分析维度 | 要求 |
|----------|------|
| **精简摘要** | 中文摘要，严格 ≤ 50 字，精准概括核心价值 |
| **技术亮点** | 提炼 2–3 个亮点，**每个亮点必须附事实依据**（如 Stars 增长数、发布版本、核心作者背景、性能基准数据等） |
| **评分** | 1–10 分，必须附评分理由 |
| **标签建议** | 推荐 3–5 个标签，小写 kebab-case，如 `multi-agent`、`rag-optimization` |

**评分标准**

| 分数段 | 含义 | 说明 |
|--------|------|------|
| 9–10 | 改变格局 | 具有行业颠覆性潜力，或解决了当前关键痛点 |
| 7–8 | 直接有帮助 | 对现有 AI/LLM/Agent 工作流有直接参考价值 |
| 5–6 | 值得了解 | 技术方向值得关注，但短期内影响有限 |
| 1–4 | 可略过 | 与 AI/LLM/Agent 关联弱，或缺乏实质创新 |

**评分约束**：单次分析批次中，9–10 分项目**不得超过 2 个**。若候选项目超过限额，优先保留影响力最大、证据最充分的 2 个，其余降至 7–8 分。评分应呈合理分布，避免集体高分。

### 步骤 3：趋势发现

跨条目进行横向分析，输出以下洞察：

- **共同主题（`common_themes`）**：识别本次批次中反复出现的技术主题或应用场景，如 `"multi-agent-collaboration"`、`"rag-optimization"`、`"llm-evaluation"`
- **新概念（`new_concepts`）**：发现首次出现或近期兴起的新技术概念、架构模式、工具类别，需说明判断依据（如首次出现在 Trending、新命名范式、新组合技术栈）

### 步骤 4：输出分析结果 JSON

将完整分析结果写入结构化 JSON 文件：`knowledge/analysis/tech_summary_{source}_{YYYY-MM-DD}.json`

其中 `{source}` 取自原始采集文件的 `source` 字段（如 `github_trending`），`YYYY-MM-DD` 为分析日期。

## 输出格式

```json
{
  "skill": "tech-summary",
  "analyzed_at": "2026-05-28T02:30:00Z",
  "raw_ref": "knowledge/raw/github_trending_2026-05-28.json",
  "trend_insights": {
    "common_themes": ["multi-agent-collaboration", "rag-optimization"],
    "new_concepts": ["hybrid-reasoning", "long-context-memory"]
  },
  "items": [
    {
      "id": "github_trending_a1b2c3d4",
      "title": "仓库或文章标题",
      "source": "github_trending",
      "source_url": "https://github.com/owner/repo",
      "summary": "50字以内中文摘要",
      "highlights": [
        "事实1：一周 Stars 增长 2000+，社区活跃度极高",
        "事实2：核心团队来自知名 AI 实验室，架构经过生产环境验证"
      ],
      "score": 8,
      "score_reason": "直接有帮助：提供了 Agent 工作流的可视化调试能力，解决了当前编排痛点",
      "tags": ["agent", "visualization", "workflow"],
      "status": "draft",
      "collected_at": "2026-05-28T02:00:00Z",
      "analyzed_at": "2026-05-28T02:30:00Z"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `skill` | string | 固定值 `"tech-summary"` |
| `analyzed_at` | string | 分析完成时间，ISO 8601 格式 |
| `raw_ref` | string | 指向本次分析的原始采集文件相对路径 |
| `trend_insights` | object | 趋势洞察 |
| `trend_insights.common_themes` | string[] | 共同技术主题 |
| `trend_insights.new_concepts` | string[] | 新兴概念或范式 |
| `items` | array | 分析后的条目列表 |
| `items[].id` | string | 全局唯一 ID，建议 `{source}_{hash8}`，与知识条目格式对齐 |
| `items[].title` | string | 仓库或文章标题 |
| `items[].source` | string | 来源标识，如 `github_trending`、`hacker_news` |
| `items[].source_url` | string | 原文链接，与知识条目 `source_url` 对齐 |
| `items[].summary` | string | 精简中文摘要，≤ 50 字 |
| `items[].highlights` | string[] | 技术亮点数组，2–3 条，附事实依据 |
| `items[].score` | number | 评分，范围 1–10 |
| `items[].score_reason` | string | 评分理由，引用评分标准档次 |
| `items[].tags` | string[] | 建议标签，小写 kebab-case |
| `items[].status` | string | 固定值 `"draft"`，供整理 Agent 后续审核 |
| `items[].collected_at` | string | 原始采集时间，ISO 8601 格式 |
| `items[].analyzed_at` | string | 本条分析完成时间，ISO 8601 格式 |

## 注意事项

1. **评分纪律**：严格遵守 9–10 分不超过 2 个的硬性约束。若候选项目超过限额，必须降分并调整理由，不得放宽标准。

2. **事实依据**：技术亮点禁止主观臆断或夸大，必须基于可验证数据（GitHub 指标、官方发布说明、版本号、作者/团队背景、性能基准等）。

3. **摘要长度**：摘要严格控制在 50 字以内，拒绝冗余修饰词和背景铺垫，直击核心价值。

4. **标签规范**：标签使用小写 kebab-case，如 `multi-agent`、`llm-inference`，避免使用宽泛标签如 `technology`、`programming`。

5. **与知识条目衔接**：`items` 中的字段尽量与 `KnowledgeArticle` 格式对齐，便于后续直接拆分导入 `knowledge/articles/`。`score_reason` 和 `highlights` 在最终入库时可归入 `metadata` 或作为审核参考。

6. **错误处理**：单条内容分析失败（如链接失效、内容无法访问）时，记录错误原因并跳过该条，不得中断整个批次的分析流程。

7. **文件覆盖**：分析结果文件按日期命名，若当天已存在同名文件，追加时间戳或中断并提示，禁止覆盖历史分析结果。

8. **合规性**：分析过程中如需补充访问外部页面（如仓库 README、官方文档），遵守目标网站服务条款，不得高频请求。
