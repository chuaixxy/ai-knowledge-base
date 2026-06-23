# Issue #01 · Collector Agent

> 源自 [AGENTS.md](../../AGENTS.md) · 上游无依赖

## Allowed Tools

- **Read** — 读取已有 raw 文件（去重合并用）
- **Write** — 写入 `knowledge/raw/` 目录
- **WebFetch** — 由 Skill 内部调用，本 Agent 不直接抓取
- **Grep / Glob** — 查找已有 raw 文件

## What to build

从 GitHub Trending、Hacker News、arXiv 三源采集 AI/LLM/Agent 领域技术动态，按 `source_id` 去重合并，生成唯一 ID，写入 `knowledge/raw/{source}-{YYYY-MM-DD}.json`。支持用户指定全量或单源采集。

核心行为：
- 调用各源对应 skill（github-trending / hackernews / arxiv）获取结构化数据
- 以 `source_id` 为唯一键去重：重跑时读取已有 raw 文件，跳过重复条目
- 每个源当天独立编号：`{source}-{YYYY-MM-DD}-{NNN}`（从 001 起）
- 新建条目标记 `status: "draft"`
- 合并已有条目 + 新条目，按 id 排序写入文件

错误处理：
- 单源抓取失败 → 跳过该源，继续其他源
- 所有源均失败 → 终止链路，汇报用户
- 数据格式异常 → 写入 `knowledge/raw/errors-{date}.json`
- 网络请求失败 → 记录错误，跳过该条目，不中断流程
- API 限流 → 等待后重试，最多 3 次

### 输出 JSON 示例

文件：`knowledge/raw/github-trending-2026-06-23.json`

```json
[
  {
    "id": "github-trending-2026-06-23-001",
    "title": "openai/agents-sdk",
    "source": "github-trending",
    "source_id": "openai/agents-sdk",
    "source_url": "https://github.com/openai/agents-sdk",
    "author": "openai",
    "published_at": "2026-06-20T00:00:00Z",
    "raw_description": "The OpenAI Agents SDK is a lightweight yet powerful framework for building multi-agent workflows...",
    "tags": [],
    "category": null,
    "relevance_score": null,
    "collected_at": "2026-06-23T10:30:00Z",
    "analyzed_at": null,
    "organized_at": null,
    "status": "draft"
  }
]
```

## Acceptance criteria

- [ ] 支持全量采集（GitHub + HN + arXiv）和按源指定采集
- [ ] 以 `source_id` 去重，重跑时不产生重复条目
- [ ] ID 格式 `{source}-{YYYY-MM-DD}-{NNN}`，每个源独立编号
- [ ] 输出写入 `knowledge/raw/{source}-{YYYY-MM-DD}.json`，2 空格缩进，ISO 8601 日期，UTF-8
- [ ] 新建条目 status 为 `draft`，tags/category/relevance_score 初始为 `null`/`[]`
- [ ] 字段包含 `author` / `published_at` / `raw_description`（源原始描述文本）
- [ ] 使用 `source_url` 存储链接
- [ ] 采集阶段**不生成** `summary`（summary 由 Analyzer 生成）
- [ ] 采集完成后汇报各源采集数和新增数
- [ ] 单源失败不阻断其他源采集
- [ ] 全源失败时终止并向用户汇报
- [ ] 格式异常写入 `knowledge/raw/errors-{date}.json`
- [ ] API 限流重试最多 3 次

## Notes

- `source_id` 取值：GitHub 用 `full_name`（如 `openai/agents-sdk`），HN 用 story ID，arXiv 用论文 ID（如 `2301.12345`）
- 每个源的 NNN 编号独立从 001 起，互不干扰
- 重跑时已有文件中的条目不会被删除或覆盖，仅跳过重复 `source_id` 并追加新条目
- `raw_description` 保留源原始描述文本，不翻译不加工
- `published_at` 为原始发布时间（GitHub 仓库创建时间、HN 发布时间、arXiv 提交时间）

## Blocked by

None — 流水线起点，可立即开始。
