---
name: arxiv
description: Fetch arXiv papers for AI/LLM/Agent/ML content via arXiv API. Use when user wants to fetch arXiv papers, 采集/抓取 arXiv 论文, look at latest AI papers, or mentions "arxiv" or "arXiv 论文".
---

# arXiv

通过 [arXiv API](http://export.arxiv.org/api/query) 拉取 AI 相关分类的最新论文（Top 50），过滤后输出 JSON 数组到 stdout，不写文件。由 Collector 调用，Collector 负责补全 `id`、`source`、`collected_at`、`status` 后写入 `knowledge/raw/arxiv-{YYYY-MM-DD}.json`。

## 流程

### 1. 查询论文

请求 `GET http://export.arxiv.org/api/query`，参数：

| 参数 | 值 |
|------|-----|
| `search_query` | `cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG+OR+cat:cs.CV+OR+cat:cs.NE` |
| `sortBy` | `submittedDate` |
| `sortOrder` | `descending` |
| `max_results` | `50` |

API 返回 Atom XML 格式。

**完成条件**：XML 响应加载成功，HTTP 200。

### 2. 解析

从 Atom XML 中提取每个 `<entry>` 的字段：

| 原始字段 | XML 路径 | 提取说明 |
|---------|---------|---------|
| arxiv_id | `<id>` | 提取末尾 ID（如 `http://arxiv.org/abs/2406.12345v1` → `2406.12345`） |
| title | `<title>` | 去除首尾空格和换行 |
| summary | `<summary>` | 论文摘要全文 |
| authors | `<author>/<name>` | 多个作者用 `, ` 拼接 |
| published | `<published>` | 首次提交日期（ISO 8601） |
| updated | `<updated>` | 最近更新日期 |
| primary_category | `<arxiv:primary_category>` | `term` 属性（如 `cs.AI`） |
| categories | `<category>` | 所有分类的 `term` 属性数组 |
| link | `<link rel="alternate">` | `href` 属性 |

**完成条件**：50 个论文对象提取完毕。

### 3. 过滤

根据每篇论文的 `title` 和 `summary`，判断是否与 AI / LLM / Agent / ML 领域直接相关。虽已按分类筛选，仍需排除仅沾边的论文（如 cs.LG 中纯数学优化的论文）。保留相关的，丢弃无关的。

**完成条件**：过滤后的列表确定。

### 4. 输出

将过滤后的列表映射到 collector schema 字段，写入 stdout。Collector 负责补全 `id`、`source`、`collected_at`、`status`。

- 查询失败 → stderr 输出 `"arXiv API 请求失败"`，stdout 返回 `[]`
- 解析不到论文 → stderr 输出 `"XML 结构变化，未能解析到论文数据"`，stdout 返回 `[]`
- 过滤后无相关论文 → stderr 输出 `"过滤后无 AI 相关论文"`，stdout 返回 `[]`

**完成条件**：合法 JSON 已输出。

## 输出

### 位置

- **stdout**：JSON 数组，由 Collector 接收
- Collector 写入：`knowledge/raw/arxiv-{YYYY-MM-DD}.json`

### 字段

严格遵循 `specs/schemas/collector-output.json`。Skill 输出 Collector 所需的全部可提取字段，Collector 仅追加 `id`、`source`、`collected_at`、`status`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source_id` | `string` | ✅ | arXiv 论文 ID（如 `2406.12345`） |
| `title` | `string` | ✅ | 论文标题 |
| `source_url` | `string` | ✅ | `https://arxiv.org/abs/{source_id}` |
| `author` | `string` | ✅ | 作者列表，用 `, ` 拼接 |
| `published_at` | `string` | ✅ | 首次提交日期（ISO 8601） |
| `raw_description` | `string` | ✅ | 论文摘要，不去掉换行不翻译 |
| `tags` | `string[]` | ✅ | 采集阶段为空数组 `[]` |
| `category` | `null` | ✅ | 采集阶段为 `null`（Analyzer 填入原生 `cs.XX`） |
| `relevance_score` | `null` | ✅ | 采集阶段为 `null`（Analyzer 填充） |
| `analyzed_at` | `null` | ✅ | 采集阶段为 `null` |
| `organized_at` | `null` | ✅ | 采集阶段为 `null` |

## 不做什么

- 不下载 PDF —— 仅获取元数据和摘要
- 不写文件 —— stdout 输出
- 不做去重（由 Collector 负责）
- 不翻译摘要 —— `raw_description` 保持英文原文

## 质量标准

1. **字段完整**：每条记录 11 个字段全部存在，类型正确，必填字段非空
2. **JSON 合法**：输出可通过 `JSON.parse()` 解析，符合 `specs/schemas/collector-output.json` 的子集校验（不含 `id`、`source`、`collected_at`、`status`）
3. **格式规范**：JSON 使用 2 空格缩进，UTF-8 编码
4. **ID 提取**：arXiv ID 去除版本号和 URL 前缀，仅保留纯 ID
5. **采集数量**：
   - 5-15 条为正常范围（三源合计 15-30）
   - 少于 5 条：检查 API 查询参数是否正确
   - 多于 15 条：过滤条件可能太松
6. **过滤准确**：排除仅沾边的论文，保留明确 AI 相关的
7. **失败兜底**：任何异常返回 `[]`，不阻塞后续流程
8. **API 限流**：arXiv API 有频率限制，单次请求即获取 50 条，无需多次请求
