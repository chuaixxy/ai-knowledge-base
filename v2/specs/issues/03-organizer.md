# Issue #03 · Organizer Agent

> 源自 [AGENTS.md](../../AGENTS.md) · 依赖 #02

## Allowed Tools

- **Read** — 读取 raw 文件（筛选 `review` 条目）和 `index.json`（去重检查）
- **Write** — 写入 `knowledge/articles/` 文件
- **Edit** — 更新 `knowledge/articles/index.json`
- **Grep / Glob** — 查找文件、检查去重
- **禁止 WebFetch** — 只处理本地数据，不访问外部

## What to build

读取已分析条目，执行质量门控（`score ≥ 0.6`），将合格条目格式化为标准 JSON 写入 `knowledge/articles/`，维护全局索引 `index.json`，并执行 7 天自动归档。

核心行为：
- 读取 `knowledge/raw/` 中 `status == "review"` 的条目
- 质量门控：`score ≥ 0.6` 合格，低于此值不写入 articles 但保留在 raw 中（分析结果不浪费）
- 去重：读取 `index.json`，以 `id` 为唯一键，跳过已存在条目
- 写入 articles：文件命名 `{YYYY-MM-DD}-{NNN}-{source}.json`，全量写入完整条目 JSON
- 更新 index.json：为每个新条目追加 index 记录
- 状态生命周期：写入后 status → `published`，设置 `organized_at`
- 自动归档：遍历 index 中 `published` 条目，`collected_at` 超过 7 天变更为 `archived`

### 输出 JSON 示例

**articles 文件**：`knowledge/articles/2026-06-23-001-github-trending.json`

```json
{
  "id": "github-trending-2026-06-23-001",
  "title": "OpenAI Agents SDK",
  "source": "github-trending",
  "source_id": "openai/agents-sdk",
  "source_url": "https://github.com/openai/agents-sdk",
  "author": "openai",
  "published_at": "2026-06-20T00:00:00Z",
  "raw_description": "The OpenAI Agents SDK is a lightweight yet powerful framework for building multi-agent workflows...",
  "summary": "OpenAI 官方发布的 Agent 开发 SDK，提供任务交接、工具调用与安全护栏等核心原语...",
  "tags": ["agent-framework", "multi-agent", "python", "openai"],
  "category": "tool",
  "score": 0.87,
  "audience": "工程师",
  "analysis_note": "OpenAI 官方出品，社区关注度极高。核心亮点在于 Guardrails 机制和任务交接原语...",
  "collected_at": "2026-06-23T10:30:00Z",
  "analyzed_at": "2026-06-23T11:00:00Z",
  "organized_at": "2026-06-23T11:30:00Z",
  "status": "published"
}
```

**index 文件**：`knowledge/articles/index.json`

```json
[
  {
    "id": "github-trending-2026-06-23-001",
    "title": "OpenAI Agents SDK",
    "source": "github-trending",
    "source_id": "openai/agents-sdk",
    "category": "tool",
    "relevance_score": 0.87,
    "tags": ["agent-framework", "multi-agent", "python"],
    "status": "published",
    "collected_at": "2026-06-23T10:30:00Z"
  }
]
```

## Articles 必填字段

每个 articles 文件必须包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 全局唯一标识（如 `github-trending-2026-06-23-001`） |
| `title` | `string` | 条目标题 |
| `source` | `string` | 来源（`github-trending` / `hackernews-top` / `arxiv`） |
| `source_url` | `string` | 原始链接 |
| `source_id` | `string` | 源原生 ID（如 `openai/agents-sdk`） |
| `tags` | `string[]` | 标签列表 |
| `status` | `string` | 状态（`published`） |

其他字段（`author`/`published_at`/`summary`/`category`/`score`/`audience`/`analysis_note`/`collected_at`/`analyzed_at`/`organized_at` 等）按 raw 数据完整保留写入。

## Acceptance criteria

- [ ] 仅处理 `status == "review"` 的条目
- [ ] `score ≥ 0.6` 的条目写入 articles，低于 0.6 保留在 raw 不写入
- [ ] 以 `id` 去重，不重复写入 articles 和 index
- [ ] articles 文件命名 `{YYYY-MM-DD}-{NNN}-{source}.json`，其中 NNN 取自 id 的序号部分
- [ ] articles 文件包含完整条目 JSON，2 空格缩进 / ISO 8601 / UTF-8
- [ ] articles **必填字段**齐全：id / title / source / source_url / source_id / tags / status
- [ ] index 条目仅含子集字段：id/title/source/source_id/category/relevance_score/tags/status/collected_at
- [ ] 写入后条目 status 更新为 `published`，`organized_at` 设为当前时间
- [ ] `collected_at` 超过 7 天的 `published` 条目自动变更为 `archived`
- [ ] 汇报整理结果：合格数、新增写入数、归档数

## Notes

- 低于 0.6 的条目**不浪费分析结果**——raw 文件中已追加的分析字段不删除
- 每个条目一个 articles 文件，不是按源合并
- NNN 从 id 中直接提取（如 `github-trending-2026-06-23-001` → NNN 为 `001`）
- index.json 以数组形式维护，每次运行追加新条目（不覆盖历史）
- 归档仅修改 `status` 为 `archived`，不删除 articles 文件或 index 记录

## Blocked by

- #02 — 需要 raw 文件中有 `review` 状态的已分析条目
