---
name: tech-summary
description: 对采集的技术内容生成中文摘要、质量评分、标签提取和读者定位。Use when user wants to analyze collected items, 生成技术摘要/分析采集数据/评分/打标签/提取标签, or when Analyzer agent processes raw files.
---

# Tech Summary

从 `knowledge/raw/` 读取 JSON 文件，对未分析条目逐条生成摘要、评分、标签、分类和读者定位，原地追加分析字段，状态 `draft` → `review`。由 Analyzer 调用。

## 流程

### 1. 读取数据

读取 `knowledge/raw/` 下所有 JSON 文件（或用户指定的文件）。

**完成条件**：所有目标文件加载完毕。

### 2. 增量识别

遍历每个条目，`score` 为 `null` → 未分析，需处理；`score` 不为 `null` → 已分析，跳过。

**完成条件**：待处理条目列表确定。

### 3. 逐条分析

对每个未分析条目执行以下子步骤：

#### 3a. 补充信息（可选）

当 `raw_description` 为空或内容过短时，通过 `source_url` 获取更多信息：

- GitHub 仓库：通过 webfetch 获取 README 前 500 字
- 博客/文章：通过 webfetch 获取正文前 1000 字
- 获取失败不阻塞流程，基于已有信息继续

补充信息仅供分析使用，不写入文件。

#### 3b. 生成摘要

基于 `raw_description` 及补充信息，生成 100-200 中文字符的技术摘要。

摘要必须覆盖四要素：

| 要素 | 内容 |
|------|------|
| 这是什么 | 用一句话说清楚项目/文章的核心内容 |
| 为什么重要 | 对 AI/LLM/Agent 从业者的实际价值 |
| 关键技术点 | 提及的核心技术、架构、算法（如有） |
| 适用场景 | 谁会用到、什么场景下有用 |

写作规范：

- 第一句直接点明核心，不要"本项目是..."、"这篇文章介绍了..."等模板开头
- 技术术语保留英文原文，如 RAG、MCP、Fine-tuning
- 避免空洞的形容词（"强大的"、"创新性的"）——用具体信息替代
- 如果能写出具体数字（性能提升、模型大小等），优先使用数字

好示例：`OpenAI 官方 Agent 开发 SDK。对 Agent 工程化落地有直接参考价值，核心亮点在于 Guardrails 安全护栏和任务交接原语，支持多 Agent 编排。适合需要将 LLM Agent 集成到生产环境的工程师。`

差示例：`这是一个很强大的 AI Agent 框架，开源社区非常活跃，功能丰富，值得深入学习。推荐给大家。`

#### 3c. 评分

5 维度加权综合评分（0-1，保留两位小数）：

| 维度 | 权重 | 高分特征（0.8-1.0） | 低分特征（0-0.3） |
|------|------|---------------------|-------------------|
| 实用价值 | 30% | 可立即落地的工具/SDK/框架 | 纯理论探讨，无工程化路径 |
| 技术深度 | 25% | 有新的架构设计、算法创新 | 浅层介绍，无实质技术内容 |
| 时效性 | 15% | 本周/本月新发布 | 已发布超过半年且无持续更新 |
| 社区热度 | 15% | stars >1000，高讨论度 | 几乎无关注 |
| 领域匹配 | 15% | 直接涉及 LLM/Agent/RAG 等 | 仅沾边 |

仅输出综合 `score`，不保留各维度分项值。绝对评分，不受同批次其他条目影响。

#### 3d. 标签

从标签词库中优先选取，保持标签一致性。至少 1 项，英文小写，连字符分隔。

**标签词库**（优先使用）：

| 类别 | 可选标签 |
|------|---------|
| 领域 | `large-language-model`, `agent-framework`, `rag`, `mcp`, `fine-tuning`, `prompt-engineering`, `multi-agent`, `code-generation` |
| 技术 | `transformer`, `attention`, `embedding`, `vector-database`, `knowledge-graph` |
| 工具 | `langchain`, `llamaindex`, `openai`, `anthropic`, `deepseek`, `huggingface` |
| 场景 | `chatbot`, `code-assistant`, `data-analysis`, `document-qa`, `workflow-automation` |

词库未覆盖的标签可自定义，但需遵循命名规范：英文小写、连字符分隔。

#### 3e. 分类

| 来源 | 分类规则 |
|------|---------|
| ArXiv | 直接用原生 `cs.XX` 分类 |
| GitHub / Hacker News | `tool` / `framework` / `paper` / `benchmark` / `tutorial` 之一 |

#### 3f. 读者定位

目标读者四选一：`研究者`、`工程师`、`产品经理`、`通用`。

#### 3g. 分析备注

50-150 字，记录评分依据、项目亮点、潜在风险，辅助后续人工复核。中文自然流畅，不用翻译腔。

**完成条件**：条目分析字段全部填写完毕。

### 4. 输出

将分析字段追加到原条目，状态 `"draft"` → `"review"`，原地写回 raw 文件。

- 源信息不足且获取失败 → 基于已有信息生成，不编造

**完成条件**：所有待处理条目已写回，文件保存。

## 输出

### 位置

- 原地改写：`knowledge/raw/{source}-{YYYY-MM-DD}.json`
- 仅追加分析字段，不修改原始字段（`source_id`、`source_url`、`raw_description` 等原样保留）

### 字段

严格遵循 `specs/schemas/analyzer-output.json`。在 collector 字段基础上追加：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `summary` | `string` | ✅ | 中文技术摘要，100-200 字 |
| `tags` | `string[]` | ✅ | 标签列表，≥1 项 |
| `category` | `string` | ✅ | 分类 |
| `score` | `number` | ✅ | 综合评分，0-1，保留两位小数 |
| `audience` | `string` | ✅ | 目标读者，四选一 |
| `analysis_note` | `string` | ✅ | 分析备注，50-150 字 |
| `analyzed_at` | `string` | ✅ | 分析时间，ISO 8601 |
| `status` | `string` | ✅ | `"draft"` → `"review"` |

## 不做什么

- 不写 `knowledge/articles/`（由 Organizer 负责）
- 不修改不属于分析字段的原始数据
- 源信息不足且获取失败时，不编造内容
- 不写入 `readme_excerpt` 等中间字段

## 质量标准

1. **摘要**：100-200 中文字符，四要素齐全，直接切入无模板开头
2. **标签**：≥1 项，优先使用词库，命名符合规范
3. **评分**：0-1 区间，保留两位小数，5 维度均考虑
4. **分类**：ArXiv 取原生 `cs.XX`，其他从枚举中选
5. **读者**：四选一，与内容匹配
6. **备注**：50-150 字，有评分依据
7. **增量**：`score` 非 null 的条目不重复分析
8. **批量**：逐条独立处理，不因前后条目影响评分
9. **兜底**：信息不足时不编造，标注分析限制
