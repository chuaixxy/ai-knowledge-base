# AGENTS.md — AI 知识库 v2

> 项目记忆与 Agent 协作规范，OpenCode 启动时自动加载。

## 项目定义

**AI Knowledge Base（AI 知识库）** 是一个按需触发的技术情报采集与分析系统。
通过 3 个 Agent 串行协作（Collector → Analyzer → Organizer），
将分散的技术资讯转化为结构化、可检索的知识条目。

### 核心价值

- 按需采集 GitHub Trending、Hacker News、arXiv 的 AI/LLM/Agent 领域高质量内容
- 多维度评分（实用价值/技术深度/时效性/社区热度/领域匹配）+ 标签分类
- 输出格式统一的 JSON 知识条目，具备全局索引
- 保留来源与采集时间，保证内容可追溯

## 技术栈

- **运行时**：OpenCode + LLM（DeepSeek / Qwen 等）
- **数据源**：GitHub Trending、Hacker News、arXiv
- **输出格式**：JSON
- **版本管理**：Git

## 项目结构

```text
.
├── AGENTS.md                              # 项目记忆文件（本文件）
├── opencode.json                          # opencode 配置
├── specs/
│   └── knowledge-base.md                  # 详细设计规格
├── .opencode/
│   ├── agents/
│   │   ├── collector.md                   # 采集 Agent
│   │   ├── analyzer.md                    # 分析 Agent
│   │   └── organizer.md                   # 整理 Agent
│   └── skills/
│       ├── github-trending/SKILL.md       # GitHub Trending 采集技能
│       ├── hackernews/SKILL.md            # Hacker News 采集技能
│       └── arxiv/SKILL.md                 # arXiv 采集技能
└── knowledge/
    ├── raw/                               # 原始采集数据（JSON）
    │   ├── github-trending-{YYYY-MM-DD}.json
    │   ├── hackernews-top-{YYYY-MM-DD}.json
    │   ├── arxiv-{YYYY-MM-DD}.json
    │   └── errors-{YYYY-MM-DD}.json
    └── articles/                          # 整理后的知识条目（JSON）
        ├── index.json
        └── {YYYY-MM-DD}-{NNN}-{source}.json
```

## 编码规范

### 文件命名

- 原始数据：`knowledge/raw/{source}-{YYYY-MM-DD}.json`
  - source 取值：`github-trending` / `hackernews-top` / `arxiv`
- 知识条目：`knowledge/articles/{YYYY-MM-DD}-{NNN}-{source}.json`
  - 例：`2026-06-23-001-github-trending.json`
- 索引文件：`knowledge/articles/index.json`

### JSON 格式

- 缩进：2 空格
- 日期格式：ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）
- 字符编码：UTF-8

### 语言约定

- 代码、JSON 键名、文件名：英文
- 摘要、分析：中文
- 标签（`tags`）：英文小写，用连字符分隔

## 知识条目 JSON 格式

### 必填字段

每个知识条目必须包含：`id`, `title`, `source`, `url`, `collected_at`, `summary`, `tags`, `relevance_score`

### 完整字段

```json
{
  "id": "github-trending-2026-06-23-001",
  "title": "OpenAI Agents SDK",
  "source": "github-trending",
  "source_id": "openai/agents-sdk",
  "url": "https://github.com/openai/agents-sdk",
  "summary": "OpenAI 官方发布的 Agent 开发 SDK，提供任务交接、工具调用与安全护栏等核心原语...",
  "tags": ["agent-framework", "multi-agent", "python", "openai"],
  "category": "tool",
  "relevance_score": 0.87,
  "collected_at": "2026-06-23T10:30:00Z",
  "analyzed_at": "2026-06-23T11:00:00Z",
  "organized_at": "2026-06-23T11:30:00Z",
  "status": "published"
}
```

### Index 条目

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

## 总流程

按需触发，用户一句话启动。流水线串行：

```
[Collector] → [Analyzer] → [Organizer]
```

## Agent 职责

### Collector
- 采集源（用户可选择全量或指定源）：GitHub Trending / Hacker News / arXiv
- 去重：以 `source_id`（源原生 ID）为唯一键，重跑时读已有文件，跳过重复条目
- ID 生成：`{source}-{YYYY-MM-DD}-{NNN}`，每个源当天从 001 起独立编号
- Status：新建条目标记 `draft`
- 输出：`knowledge/raw/{source}-{YYYY-MM-DD}.json`

### Analyzer
- 读 `knowledge/raw/`，增量处理：跳过已有分析字段的条目
- 5 维度评分（0-1）：实用价值 > 技术深度 > 时效性 > 社区热度 > 领域匹配
- 标签：技术领域标签 / 应用场景标签 / 技术栈标签
- `category`：ArXiv 用原生 `cs.XX`，GitHub/HN 从 tags 中提取
- 输出：原地改写 raw 文件（追加分析字段）
- Status：分析完成后标记 `review`

### Organizer
- 合格判定：`relevance_score` ≥ 0.6
- 合格条目写入 `knowledge/articles/{YYYY-MM-DD}-{NNN}-{source}.json`
- 维护 `knowledge/articles/index.json`（以 `id` 去重）
- Status 生命周期：`draft` → `review` → `published` → `archived`
- 自动归档：`collected_at` 超过 7 天后变更为 `archived`

## Agent 协作规则

- **编排方式**：agent 串行调用（Collector → Analyzer → Organizer）
- **数据传递**：文件系统，`knowledge/raw/` → `knowledge/articles/`
- **上游失败**：任一 agent 失败，整条链路终止，用户重新手动触发
- **进度追踪**：每个 agent 完成后汇报进度
- **去重**：Collector 以 `source_id` 去重，Organizer 以 `id` 去重
- **幂等**：Collector 重跑读已有文件合并；Analyzer 增量处理跳过已分析条目

## Agent 调用方式

```text
@collector 采集今天的 GitHub Trending、Hacker News 和 arXiv 数据
@collector 只看 arXiv 今天有什么新论文
```

用户可指定采集源：全量 / GitHub / HN / ArXiv。
编排 agent 依次调用：`collector` → `analyzer` → `organizer`。

## 错误处理

| 场景 | 策略 |
|------|------|
| 网络请求失败 | 记录错误，跳过该条目，不中断整体流程 |
| API 限流 | 等待后重试，最多 3 次 |
| 数据格式异常 | 写入 `knowledge/raw/errors-{date}.json` 供人工排查 |
| 单个采集源全部失败 | 跳过该源，继续采集其他源 |
| 所有采集源均失败 | 终止整条链路，汇报用户 |

## 红线

1. 不得提交或硬编码密钥、Token、`.env` 内容。
2. 不得覆盖或删除历史 `knowledge/raw/` 文件。
3. 不得为同一 `source_id` 生成多个重复知识条目。
4. 不得写入与 AI/LLM/Agent 无关的内容。
5. 不得执行未授权的 shell 或任意网络请求。
6. 不得绕过 Analyzer 直接写入最终 articles。
7. 不得修改其他 Agent 定义而不说明原因。

## 开发与验证

- 运行采集：由 `@collector` 触发
- 运行分析：由 `@analyzer` 触发
- 运行整理：由 `@organizer` 触发
