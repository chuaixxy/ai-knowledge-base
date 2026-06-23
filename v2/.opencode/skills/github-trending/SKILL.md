---
name: github-trending
description: Scrape GitHub Trending repositories for AI/LLM/Agent/ML content via HTML parsing. Use when user wants to fetch GitHub Trending, 采集/抓取/爬取 GitHub trending, look at GitHub 热门/趋势项目, check trending repos on GitHub, or mentions "github trending" in any context.
---

# GitHub Trending

抓取 [GitHub Trending](https://github.com/trending) 页面，HTML 解析（不用 API），过滤后输出 JSON 数组到 stdout，不写文件。由 Collector 调用，Collector 负责补全 `id`、`source`、`collected_at`、`status` 后写入 `knowledge/raw/github-trending-{YYYY-MM-DD}.json`。

## 流程

### 1. 拉取页面

用 webfetch 请求 `https://github.com/trending`，指定 `html` 格式。

**完成条件**：HTML 加载成功，HTTP 200。

### 2. 解析

从 HTML 中提取 Top 50 仓库。提取时保留完整信息用于后续过滤，最终输出时映射到 collector schema 字段。

解析阶段提取的原始数据：

| 原始字段 | 类型 | 提取说明 |
|---------|------|---------|
| owner/repo | `string` | 完整名称，不可为空 |
| url | `string` | `https://github.com/{owner}/{repo}` |
| stars | `number` | 总星数，`1.2k` → `1200`，`10k` → `10000` |
| topics | `string[]` | topic 字符串数组，没有则为 `[]` |
| description | `string` | 原始描述文本，没有则为 `""` |

用正则/字符串匹配即可，数据全在服务端渲染的 HTML 里。

**完成条件**：50 个仓库对象提取完毕。

### 3. 过滤

根据每个仓库的 `topics` 和 `description`，判断是否与 AI / LLM / Agent / ML 领域相关。保留相关的，丢弃无关的。

**完成条件**：过滤后的列表确定。

### 4. 输出

将过滤后的列表映射到 collector schema 字段，写入 stdout。Collector 负责补全 `id`、`source`、`collected_at`、`status`。

- 拉取页面失败 → stderr 输出 `"GitHub Trending 页面请求失败"`，stdout 返回 `[]`
- 解析不到数据 → stderr 输出 `"HTML 结构变化，未能解析到仓库数据"`，stdout 返回 `[]`
- 过滤后无相关仓库 → stderr 输出 `"过滤后无 AI 相关仓库"`，stdout 返回 `[]`

**完成条件**：合法 JSON 已输出。

## 输出

### 位置

- **stdout**：JSON 数组，由 Collector 接收
- Collector 写入：`knowledge/raw/github-trending-{YYYY-MM-DD}.json`

### 字段

严格遵循 `specs/schemas/collector-output.json`。Skill 输出 Collector 所需的全部可提取字段，Collector 仅追加 `id`、`source`、`collected_at`、`status`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source_id` | `string` | ✅ | GitHub 仓库完整名称 `owner/repo` |
| `title` | `string` | ✅ | 条目标题，取 `owner/repo` |
| `source_url` | `string` | ✅ | GitHub 仓库 URL |
| `author` | `string` | ✅ | 作者/组织名，取 owner |
| `published_at` | `string \| null` | ✅ | trending 页无此数据，固定 `null` |
| `raw_description` | `string` | ✅ | 原始描述文本，不翻译不加工，无则 `""` |
| `tags` | `string[]` | ✅ | 采集阶段为空数组 `[]` |
| `category` | `null` | ✅ | 采集阶段为 `null` |
| `relevance_score` | `null` | ✅ | 采集阶段为 `null`（Analyzer 填充） |
| `analyzed_at` | `null` | ✅ | 采集阶段为 `null` |
| `organized_at` | `null` | ✅ | 采集阶段为 `null` |

## 质量标准

1. **字段完整**：每条记录 11 个字段全部存在，类型正确，必填字段非空
2. **JSON 合法**：输出可通过 `JSON.parse()` 解析，符合 `specs/schemas/collector-output.json` 的子集校验（不含 `id`、`source`、`collected_at`、`status`）
3. **格式规范**：JSON 使用 2 空格缩进，UTF-8 编码
4. **采集数量**：
   - 15-30 条为正常范围
   - 少于 10 条：关键词可能需要扩展，报告给用户
   - 多于 50 条：过滤条件可能太宽松，提高 Star 阈值
5. **过滤准确**：与 AI/LLM/Agent/ML 明确无关的仓库不输出
6. **失败兜底**：任何异常返回 `[]`，不阻塞后续流程
7. **单次执行 < 10s**
