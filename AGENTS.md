# AGENTS.md — AI 知识库项目

> 本文件是项目的项目记忆与 Agent 协作规范，OpenCode 启动时自动加载，指导所有 Agent 的行为。

## 项目定义

**AI Knowledge Base（AI 知识库）** 是一个自动化技术情报收集与分析系统。
它持续追踪 GitHub Trending、Hacker News、arXiv 等来源，将分散的技术资讯转化为结构化、可检索的知识条目。

### 核心价值

- 每日自动采集 AI/LLM/Agent 领域的高质量技术文章与开源项目
- 通过 Agent 协作完成 **采集 → 分析 → 整理** 三阶段流水线
- 输出格式统一的 JSON 知识条目，便于下游应用消费
- 保留来源与采集时间，保证内容可追溯

## 技术栈

- **运行时**：OpenCode + LLM（DeepSeek / Qwen 等）
- **数据源**：GitHub Trending、Hacker News、arXiv
- **输出格式**：JSON
- **版本管理**：Git

## 项目结构

```text
.
├── AGENTS.md                          # 项目记忆文件（本文件）
├── .env.example                       # 环境变量模板
├── README.md                          # 使用说明
├── .opencode/
│   ├── agents/
│   │   ├── collector.md               # 采集 Agent 角色定义
│   │   ├── analyzer.md                # 分析 Agent 角色定义
│   │   └── organizer.md               # 整理 Agent 角色定义
│   └── skills/
│       ├── github-trending/SKILL.md   # GitHub Trending 采集技能
│       └── tech-summary/SKILL.md      # 技术摘要生成技能
└── knowledge/
    ├── raw/                           # 原始采集数据（JSON）
    ├── articles/                      # 整理后的知识条目（JSON）
    └── incidents/                     # 异常或失败记录
```

## 编码规范

### 文件命名

- 原始数据：`knowledge/raw/{source}-{YYYY-MM-DD}.json`
  - 例：`knowledge/raw/github-trending-2026-03-17.json`
  - 例：`knowledge/raw/hacker-news-2026-03-17.json`
  - 例：`knowledge/raw/arxiv-2026-03-17.json`
- 知识条目：`knowledge/articles/{YYYY-MM-DD}-{seq}.json`
  - 例：`knowledge/articles/2026-03-17-001.json`
  - 例：`knowledge/articles/2026-03-17-002.json`
- 索引文件：`knowledge/articles/index.json`

### JSON 格式

- 使用 2 空格缩进
- 日期格式：ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）
- 字符编码：UTF-8

### 语言约定

- 代码、JSON 键名、文件名：英文
- 摘要、分析、注释：中文
- 标签（`tags`）：英文小写，用连字符分隔，如 `large-language-model`

## 知识条目 JSON 格式

每条知识条目对应 `knowledge/articles/{YYYY-MM-DD}-{seq}.json`。

### 必填字段

- `id`: 全局唯一 ID，建议 `{source}_{hash8}` 或 UUID
- `title`: 标题
- `source`: 来源，限定为 `github_trending` / `hacker_news` / `arxiv`
- `source_url`: 原文链接
- `collected_at`: 采集时间，ISO 8601
- `summary`: 中文摘要
- `tags`: 标签数组
- `score`: 质量评分，1-10 整数
- `status`: 条目状态，限定为 `draft` / `review` / `published` / `archived`

### 推荐字段

- `highlights`: 技术亮点，2-3 项，每项不超过 30 字
- `score_reason`: 评分理由
- `description`: 英文原文描述
- `author`: 作者、提交者或仓库 maintainer
- `published_at`: 原文发布时间，ISO 8601
- `analyzed_at`: AI 分析完成时间，ISO 8601
- `raw_ref`: 指向 `knowledge/raw/` 中原始文件的相对路径
- `metadata`: 来源扩展字段

### 可选热度字段

- `stars`: 热度数值
  - GitHub Trending：可表示当日新增 stars 或排序热度
  - Hacker News：可表示 points
  - arXiv：通常可为空，由 `metadata` 承载补充信息

### 示例

```json
{
  "id": "github_trending_a3f2b1c8",
  "title": "OpenAI Agents SDK",
  "source": "github_trending",
  "source_url": "https://github.com/example/repo",
  "summary": "一个用于构建多 Agent 工作流的开源 SDK，强调工具调用、状态传递与可观测性。",
  "highlights": [
    "支持多 Agent 编排",
    "内置工具调用机制",
    "强调可观测性"
  ],
  "score": 8,
  "score_reason": "项目工程化程度高，适合生产环境探索。",
  "tags": ["agent", "llm", "open-source"],
  "status": "draft",
  "stars": 1234,
  "description": "A production-ready SDK for building agent workflows.",
  "author": "openai",
  "published_at": "2026-03-17T08:00:00Z",
  "collected_at": "2026-03-17T10:00:00Z",
  "analyzed_at": "2026-03-17T10:05:00Z",
  "raw_ref": "knowledge/raw/github-trending-2026-03-17.json",
  "metadata": {
    "language": "Python",
    "stars_total": 42000
  }
}
```

## 工作流规则

### 三阶段流水线

```text
[Collector] ──采集──→ knowledge/raw/
                          │
[Analyzer]  ──分析──→ enriched JSON
                          │
[Organizer] ──整理──→ knowledge/articles/
```

### Agent 协作规则

1. **单向数据流**：Collector → Analyzer → Organizer，不可反向操作。
2. **职责隔离**：每个 Agent 仅处理自己阶段的数据，不越权修改其他阶段产物。
3. **幂等性**：重复运行同一天任务不应产生重复条目。
4. **质量门控**：Analyzer 评分低于 6 分的条目，Organizer 应丢弃。
5. **可追溯**：每个条目必须保留 `source_url` 和 `collected_at`，建议保留 `raw_ref`。
6. **仅输出 JSON**：当前版本不生成 Markdown 日报，不向外部分发。

## Agent 角色概览

### Collector

职责：
- 从 GitHub Trending、Hacker News、arXiv 拉取原始条目
- 过滤明显无关内容
- 输出原始 JSON 到 `knowledge/raw/`

输入：
- 调度触发 / 手动触发

输出：
- `knowledge/raw/{source}-{YYYY-MM-DD}.json`

要求：
- 单来源尽量采集足够条目
- `github_trending` 不设硬性上限，`hacker_news` 最多保留 10 条，`arxiv` 最多保留 15 条
- 网络错误时可跳过单条，不中断整体流程
- 不负责评分、标签、去重、落最终文章

### Analyzer

职责：
- 读取 `knowledge/raw/` 中的原始数据
- 生成摘要、亮点、评分、评分理由和标签建议

输入：
- `knowledge/raw/*.json`

输出：
- 结构化分析结果，供 Organizer 消费

要求：
- `summary` 使用中文
- `highlights` 为 2-3 条
- `score` 使用 1-10 整数
- 不直接发布最终 articles

### Organizer

职责：
- 汇总分析结果
- 去重、标准化、写入 `knowledge/articles/`
- 维护 `knowledge/articles/index.json`

输入：
- Analyzer 输出结果

输出：
- `knowledge/articles/{YYYY-MM-DD}-{seq}.json`
- `knowledge/articles/index.json`

要求：
- 以 `source_url` 为主要去重键
- 仅保留通过质量门控的条目
- 同一天内按三位顺序号命名，如 `001`、`002`、`003`
- 当前阶段不生成 Markdown，不做推送

## Agent 调用方式

在 OpenCode 中使用 `@` 语法调用特定 Agent：

```text
@collector 采集今天的 GitHub Trending、Hacker News 和 arXiv 数据
@analyzer 分析 knowledge/raw/github-trending-2026-03-17.json
@organizer 整理今天所有已分析的数据
```

也可以要求主 Agent 依次委派子 Agent，按流水线顺序执行。

## 错误处理

- 网络请求失败时，记录错误并跳过该条目，不中断整体流程
- API 限流时，等待后重试，最多 3 次
- 数据格式异常时，写入 `knowledge/incidents/errors-{date}.json` 供人工排查
- 任一阶段失败时，不得输出非 JSON 的半成品文件

## 红线

1. 不得提交或硬编码密钥、Token、`.env` 内容。
2. 不得覆盖或删除历史 `knowledge/raw/` 文件。
3. 不得为同一 `source_url` 生成多个重复知识条目。
4. 不得输出 Markdown 日报或外部推送内容，除非后续规范明确开启。
5. 不得写入与 AI/LLM/Agent 无关的内容。
6. 不得执行未授权的 shell 或任意网络请求。
7. 不得绕过 Analyzer 直接写入最终 articles。
8. 不得修改其他 Agent 定义而不说明原因。

## 开发与验证

- 运行采集：由 `@collector` 或工作流触发
- 运行分析：由 `@analyzer` 或工作流触发
- 运行整理：由 `@organizer` 或工作流触发
- 提交前应确认：
  - JSON 结构合法
  - 无重复条目
  - 字段完整
  - 时间格式正确
