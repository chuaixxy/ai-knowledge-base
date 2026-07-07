---
name: daily-digest
description: 生成今日 AI 技术简报，汇总当天采集的 Top 5 知识条目，按相关性排序
allowed-tools:
  - Read
---

# 每日简报技能

## 触发条件

当用户想要查看今日 / 本周 AI 技术汇总时激活。
典型触发词：简报、摘要、今日、daily、digest、briefing

## 生成流程

> **重要 · 只允许 Read**：本技能不能用 Glob / Grep / exec。所有操作从 `Read knowledge/articles/index.json` 开始。

### Step 1: 读索引定位今日数据

用 `Read` 读 `knowledge/articles/index.json`（含每篇文章的 `id` / `title` / `category` / `relevance_score` / `tags` / `collected_at`）。

**在内存里筛**今日的条目（`collected_at` 字段以今日日期开头，或 `id` 前缀为 `YYYY-MM-DD`）；今日无数据则回退到最近 7 天。

> **不要尝试 Glob 或 grep 文件名** —— 索引文件已经聚合了所有元信息，一次 Read 就够了。

### Step 2: 内存过滤 + 排序

1. 过滤 `relevance_score >= 0.6` 的条目（评分为 0–1 浮点数）
2. 按 technology bucket 分组（与 `distribution/formatter.ts` 的 `groupByBucket` 一致：优先从 `tags` 映射，其次 `category`，如 MCP / Agent / RAG / Framework / Tool / Paper 等）
3. 每个 bucket 内按 `relevance_score` 降序排序，取 Top 5

只对最终要进简报的文章，用 `Read knowledge/articles/{id}.json` 拿 `summary` / `url` / `key_insight` 等完整字段（**不要批量读全部**）。

### Step 3: 按 bucket 分组生成 Markdown 简报

输出格式与 `distribution/formatter.ts` 的 `renderDigestMarkdown` 一致：

```markdown
# 知识库日报 YYYY-MM-DD

> 当日收录 **N** 篇，精选 M 篇

## MCP
### 1. 文章标题
...
```

## 与 Publisher 的分工

- **本 Skill**：格式化文本，生成 Markdown 简报（对应 `distribution/formatter.ts` 的 `generateDailyDigest`）
- **distribution/publisher.ts**：把简报推送到飞书 / 文件（`output/digest-YYYY-MM-DD.md`）
- **distribution/daily-digest.ts**：CLI 定时推送入口（`npx tsx distribution/daily-digest.ts`）

Skill 负责"写"，Publisher 负责"发"。
