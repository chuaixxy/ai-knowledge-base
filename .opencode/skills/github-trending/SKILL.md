---
name: github-trending
description: 当需要采集 GitHub 热门开源项目时使用此技能
allowed-tools: Read, Grep, Glob, WebFetch
---

# GitHub Trending 采集技能

## 使用场景

本技能适用于以下场景：

- 每日/每周定时采集 GitHub Trending 上的热门开源项目
- 为 AI 知识库补充前沿技术动态
- 筛选与 AI、LLM、Agent 相关的优质开源项目
- 生成结构化数据供后续分析 Agent 处理

## 执行步骤

### 步骤 1：搜索热门仓库

使用 WebFetch 访问 GitHub Trending 页面或 GitHub API，获取当前热门仓库列表。

- **推荐 API**：`https://api.github.com/search/repositories`
- **查询参数**：`sort=stars`, `order=desc`, `q=created:>YYYY-MM-DD`
- **备用方式**：若 API 限流，可访问 `https://github.com/trending` 按语言筛选

### 步骤 2：提取信息

从每个仓库中提取以下字段：

| 字段 | 来源 |
|------|------|
| `name` | 仓库全名（`owner/repo`） |
| `source_url` | `html_url` |
| `stars` | `stargazers_count` |
| `language` | `language` |
| `topics` | `topics` 数组 |
| `description` | `description`（原始英文） |

### 步骤 3：过滤

执行两轮过滤：

1. **纳入条件**：仓库与 AI / LLM / Agent 领域相关。判断依据：
   - `topics` 包含 `llm`, `ai`, `agent`, `langchain`, `openai`, `transformers`, `rag` 等关键词
   - 或 `description` 包含上述领域关键词
   - 或 `language` 为 Python / TypeScript / Rust / Go 且描述匹配 AI 场景

2. **排除条件**：
   - 属于 Awesome 列表（名称含 `awesome-` 或描述含 "curated list"）
   - 纯教程/示例仓库（无实质工程价值）
   - Fork 数量显著高于 Star 的非原创项目

### 步骤 4：去重

使用 Grep 检查 `knowledge/raw/` 目录下已有文件，确保同一仓库在当前批次中仅出现一次。

- 去重键：`source_url`（优先）或 `name`
- 若同一仓库在不同日期重复出现，允许保留（记录不同采集时间）

### 步骤 5：撰写中文摘要

对通过过滤的仓库，使用以下公式生成中文摘要：

> **公式**：`项目名` + `做什么` + `为什么值得关注`

**示例**：

```
LangGraph 是一个用于构建多 Agent 工作流的框架，提供持久化状态、人机协作中断与可视化调试能力。值得关注是因为它在生产级 Agent 编排场景提供了明确的图结构抽象，近期发布 1.0 正式版。
```

摘要要求：
- 100–300 字
- 语言简洁、专业
- 突出技术亮点或近期重大更新

### 步骤 6：排序取 Top 15

按以下规则排序并截取前 15 条：

1. **首要依据**：与 AI/LLM/Agent 的相关性（通过关键词匹配度或模型评分）
2. **次要依据**：Star 增长数或当前 Stars
3. **补充依据**：社区活跃度（最近更新时间、Issue 响应速度）

### 步骤 7：输出 JSON

将结果写入文件：`knowledge/raw/github_trending_YYYY-MM-DD.json`

文件路径中的 `YYYY-MM-DD` 替换为实际采集日期。

## 输出格式

```json
{
  "source": "github_trending",
  "skill": "github-trending",
  "collected_at": "2026-05-28T02:00:00Z",
  "items": [
    {
      "name": "owner/repo-name",
      "source_url": "https://github.com/owner/repo-name",
      "summary": "中文摘要内容...",
      "stars": 1234,
      "language": "Python",
      "topics": ["llm", "agent", "framework"]
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | string | 固定值 `"github_trending"` |
| `skill` | string | 固定值 `"github-trending"` |
| `collected_at` | string | 采集时间，ISO 8601 格式 |
| `items` | array | 仓库条目列表，最多 15 条 |
| `items[].name` | string | 仓库全名（`owner/repo`） |
| `items[].source_url` | string | GitHub 仓库链接，与知识条目 `source_url` 对齐 |
| `items[].summary` | string | 中文摘要（100–300 字） |
| `items[].stars` | number | 当前 Star 数 |
| `items[].language` | string | 主要编程语言 |
| `items[].topics` | string[] | GitHub 话题标签 |

## 注意事项

1. **API 限流**：GitHub API 有每小时请求限额，建议：
   - 使用 `GITHUB_TOKEN` 提高限额
   - 在请求头中添加 `Authorization: token $GITHUB_TOKEN`
   - 遇 403/429 时优雅降级至页面抓取或中断任务

2. **数据完整性**：若 API 返回字段缺失（如 `description` 为空），保留字段但标记为 `null` 或空字符串，不得构造假数据。

3. **文件覆盖**：输出文件按日期命名，**禁止覆盖**已存在的历史文件。若当天已采集，追加时间戳或中断并提示。

4. **错误处理**：任一仓库获取失败（如 404、网络超时），记录错误并继续处理其他仓库，不得因单条失败中断整个任务。

5. **合规性**：
   - 遵守 GitHub 服务条款及 robots.txt
   - 不得高频请求（建议间隔 ≥ 1 秒）
   - 采集数据仅用于内部分析，不得用于商业爬取或重新分发

6. **关联红线**：本技能产出写入 `knowledge/raw/`，仅追加、不覆盖历史归档，与分析 Agent 衔接时需确保 `raw_ref` 指向正确。
