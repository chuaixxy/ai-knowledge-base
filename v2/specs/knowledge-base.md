# AI 知识库 · Agent协作规格

## 总流程

按需触发，用户一句话启动。流水线串行：

```
[Collector] → [Analyzer] → [Organizer]
```

## Agent职责

### Collector
- 采集源（用户可选择全量或指定源）：
  - GitHub: `https://api.github.com/search/repositories`，过滤 AI 相关
  - HackerNews: `https://hacker-news.firebaseio.com/v0/topstories.json`
  - ArXiv: `cs.AI` / `cs.CL` / `cs.LG` / `cs.CV` / `cs.NE` 等分类
- 输出: `knowledge/raw/{source}-{YYYY-MM-DD}.json`
- 去重: 以 `source_id`（源原生 ID）为唯一键，重跑时读已有文件，跳过重复条目
- ID 生成: `{source}-{YYYY-MM-DD}-{NNN}`，每个源当天独立编号，从 001 起
- Status: 新建条目标记 `draft`

### Analyzer
- 读 `knowledge/raw/`，增量处理：跳过已有分析字段的条目，只处理未分析的
- 分析产出（追加到 raw 文件每个条目中）：
  - 技术摘要
  - 5 维度评分（0-1）：实用价值 > 技术深度 > 时效性 > 社区热度 > 领域匹配（具体权重由 analyzer prompt 定义）
  - 高亮标签：技术领域标签 / 应用场景标签 / 技术栈标签
  - `category` 字段：ArXiv 用原生 `cs.XX`；GitHub/HN 从 tags 中提取
  - `relevance_score`：5 维度加权总分
- 输出: 原地改写 `knowledge/raw/{source}-{YYYY-MM-DD}.json`（追加分析字段）
- Status: 分析完成后标记 `review`

### Organizer
- 读 analyzed 的 raw 文件
- 合格判定: `relevance_score` ≥ 0.6
- 合格条目写入 `knowledge/articles/{YYYY-MM-DD}-{NNN}-{source}.json`
- 不合格条目保留分析结果，但丢弃（不写入 articles）
- 维护 `knowledge/articles/index.json`（追加记录，以 id 去重）
- Status 生命周期: `draft` → `review` → `published` → `archived`
  - `draft`: Collector 创建
  - `review`: Analyzer 标注
  - `published`: Organizer 写入 articles 后
  - `archived`: `collected_at` 超过 7 天后自动变更

## JSON 格式规范

- 缩进：2 空格
- 日期格式：ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）
- 字符编码：UTF-8
- 每个知识条目必含字段：`id`, `title`, `source`, `url`, `collected_at`, `summary`, `tags`, `relevance_score`

## 数据格式

### Raw / Analyzed 条目（knowledge/raw/）
```json
{
  "id": "github-trending-2026-06-23-001",
  "title": "OpenAI Agents SDK",
  "source": "github-trending",
  "source_id": "openai/agents-sdk",
  "url": "https://github.com/openai/agents-sdk",
  "summary": "OpenAI 官方发布的 Agent 开发 SDK...",
  "tags": ["agent-framework", "multi-agent", "python", "openai"],
  "category": "tool",
  "relevance_score": 0.87,
  "collected_at": "2026-06-23T10:30:00Z",
  "analyzed_at": "2026-06-23T11:00:00Z",
  "organized_at": "2026-06-23T11:30:00Z",
  "status": "published"
}
```

### Index 条目（knowledge/articles/index.json）
```json
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
```

### 目录结构
```
knowledge/
├── raw/
│   ├── github-trending-2026-06-23.json
│   ├── hackernews-top-2026-06-23.json
│   ├── arxiv-2026-06-23.json
│   └── errors-2026-06-23.json
└── articles/
    ├── index.json
    ├── 2026-06-23-001-github-trending.json
    └── 2026-06-23-001-hackernews-top.json
```

## Agent 协作规则

- **编排方式**: agent 串行调用，上游完成后下游启动（Collector → Analyzer → Organizer → Publisher）
- **数据传递**: 文件系统，`knowledge/raw/` → `knowledge/articles/`
- **上游失败**: 任一 agent 失败，整条链路终止，用户重新手动触发
- **进度追踪**: 每个 agent 完成后汇报进度
- **去重**:
  - Collector: 以 `source_id`（源原生 ID）去重
  - Organizer: 以 `id` 去重（写入前检查 index.json）
- **幂等**:
  - Collector 重跑当天: 读已有文件，按 `source_id` 合并，不覆盖已分析条目
  - Analyzer: 增量处理，跳过已有分析字段的条目

## Agent 调用方式

- 用户通过 `@collector` 触发全流程
- 用户可指定采集源：全量 / GitHub / HN / ArXiv
- 编排 agent 依次调用: `collector` → `analyzer` → `organizer`

## 错误处理

| 场景 | 策略 |
|------|------|
| 网络请求失败 | 记录错误，跳过该条目，不中断整体流程 |
| API 限流 | 等待后重试，最多 3 次 |
| 数据格式异常 | 写入 `knowledge/raw/errors-{date}.json` 供人工排查 |
| 单个采集源全部失败 | 跳过该源，继续采集其他源 |
| 所有采集源均失败 | 终止整条链路，汇报用户 |

## 技术栈

- 触发: 用户对话指令（`@collector`）
- Agent 框架: opencode subagent
- 存储: 本地文件系统（JSON）
- 外部 API: GitHub Search API, HackerNews Firebase API, ArXiv API
- 分析: LLM（内嵌于 analyzer agent prompt）
