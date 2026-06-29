---
name: hackernews
description: Fetch Hacker News top stories for AI/LLM/Agent/ML content via Firebase API. Use when user wants to fetch Hacker News, 采集/抓取 Hacker News, look at HN top stories, or mentions "hacker news" or "HN".
---

# Hacker News

通过 [Hacker News Firebase API](https://hacker-news.firebaseio.com/v0/topstories.json) 拉取 Top 50 故事，过滤后输出 JSON 数组到 stdout，不写文件。由 Collector 调用，Collector 负责补全 `id`、`source`、`collected_at`、`status` 后写入 `knowledge/raw/hackernews-top-{YYYY-MM-DD}.json`。

## 流程

### 1. 拉取 Top 故事 ID

请求 `GET https://hacker-news.firebaseio.com/v0/topstories.json`，取前 50 个 ID。

**完成条件**：50 个故事 ID 获取完毕。

### 2. 逐个拉取故事详情

对每个 ID，请求 `GET https://hacker-news.firebaseio.com/v0/item/{id}.json`。

提取原始字段：

| 原始字段 | 类型 | 提取说明 |
|---------|------|---------|
| id | `number` | 故事 ID |
| title | `string` | 故事标题 |
| url | `string` | 外部链接（可能不存在） |
| by | `string` | 作者用户名 |
| time | `number` | Unix 时间戳 |
| text | `string` | 正文（Ask HN 等类型） |
| score | `number` | 点数 |
| descendants | `number` | 评论数 |

支持批量请求，但注意 API 频率限制。

**完成条件**：50 个故事详情获取完毕。

### 3. 过滤

根据每个故事的 `title` 和 `text`，判断是否与 AI / LLM / Agent / ML 领域相关。保留相关的，丢弃无关的。

**完成条件**：过滤后的列表确定。

### 4. 输出

将过滤后的列表映射到 collector schema 字段，写入 stdout。Collector 负责补全 `id`、`source`、`collected_at`、`status`。

- 拉取 topstories 失败 → stderr 输出 `"Hacker News topstories 请求失败"`，stdout 返回 `[]`
- 故事详情拉取失败 → 跳过该故事继续，最终输出已成功获取的条目
- 过滤后无相关故事 → stderr 输出 `"过滤后无 AI 相关故事"`，stdout 返回 `[]`

**完成条件**：合法 JSON 已输出。

## 输出

### 位置

- **stdout**：JSON 数组，由 Collector 接收
- Collector 写入：`knowledge/raw/hackernews-top-{YYYY-MM-DD}.json`

### 字段

严格遵循 `specs/schemas/collector-output.json`。Skill 输出 Collector 所需的全部可提取字段，Collector 仅追加 `id`、`source`、`collected_at`、`status`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source_id` | `string` | ✅ | 故事 ID（数字转字符串） |
| `title` | `string` | ✅ | 故事标题 |
| `source_url` | `string` | ✅ | 外部链接，无则取 `https://news.ycombinator.com/item?id={id}` |
| `author` | `string` | ✅ | 作者用户名 |
| `published_at` | `string` | ✅ | Unix 时间戳转 ISO 8601 |
| `raw_description` | `string` | ✅ | 故事正文，无则为 `""` |
| `tags` | `string[]` | ✅ | 采集阶段为空数组 `[]` |
| `category` | `null` | ✅ | 采集阶段为 `null` |
| `relevance_score` | `null` | ✅ | 采集阶段为 `null`（Analyzer 填充） |
| `analyzed_at` | `null` | ✅ | 采集阶段为 `null` |
| `organized_at` | `null` | ✅ | 采集阶段为 `null` |

## 不做什么

- 不调第三方库或浏览器自动化 —— 纯 API 请求
- 不写文件 —— stdout 输出
- 不做去重（由 Collector 负责）
- 不修改原始字段值

## 质量标准

1. **字段完整**：每条记录 11 个字段全部存在，类型正确，必填字段非空
2. **JSON 合法**：输出可通过 `JSON.parse()` 解析，符合 `specs/schemas/collector-output.json` 的子集校验（不含 `id`、`source`、`collected_at`、`status`）
3. **格式规范**：JSON 使用 2 空格缩进，UTF-8 编码
4. **时间转换**：Unix 时间戳正确转为 ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）
5. **采集数量**：
   - 5-15 条为正常范围（三源合计 15-30）
   - 少于 5 条：可能今日 AI 故事较少，报告给用户
   - 多于 15 条：过滤条件可能太松
6. **过滤准确**：与 AI/LLM/Agent/ML 明确无关的故事不输出
7. **失败兜底**：整体失败返回 `[]`，个别故事失败不阻塞其他故事
8. **API 限流**：Firebase API 无严格限流，但仍建议串行请求避免触发限制
