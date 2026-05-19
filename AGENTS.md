# AI 知识库助手 — Agent 协作指南

## 项目概述

本项目是一个自动化 AI 技术情报助手：定时从 GitHub Trending 和 Hacker News 采集 AI/LLM/Agent 领域动态，经大模型分析后结构化为 JSON 知识条目，并支持通过 Telegram、飞书等渠道分发摘要与链接，帮助团队持续跟踪前沿技术动向。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 / API | Hono.js（TypeScript） |
| Agent 编排 | OpenCode + 国产大模型（如通义、DeepSeek、智谱等） |
| 工作流 | LangGraph |
| 自动化 / 调度 | OpenClaw |
| 存储 | JSON 文件（`knowledge/` 目录） |
| 分发 | Telegram Bot API、飞书 Webhook |

---

## 编码规范

- 命名：**snake_case**（文件名、JSON 字段、环境变量、数据库列名）；TypeScript 类型与类名使用 **PascalCase**，导出函数与模块内部变量在不影响 JSON 契约时可使用 **camelCase**
- 文档字符串：**Google 风格** JSDoc / TSDoc
- 日志：使用统一 logger（如 `pino`），禁止在业务逻辑中直接 `console.log`
- 类型：公共 API 与知识条目结构必须定义 TypeScript interface / type
- 依赖：新增依赖写入 `package.json`，并注明用途

```typescript
/**
 * 从 GitHub Trending 拉取指定语言的仓库列表。
 *
 * @param language - 编程语言筛选，默认 python。
 * @returns 仓库元数据列表。
 */
export async function fetch_trending_repos(
  language: string = "python",
): Promise<TrendingRepo[]> {
  logger.info({ language }, "fetching trending repos");
  // ...
}
```

---

## 项目结构

```
.
├── AGENTS.md                 # 本文件：Agent 协作与项目约定
├── .opencode/
│   ├── agents/               # OpenCode Agent 定义（采集 / 分析 / 整理）
│   └── skills/               # 可复用技能（爬虫、摘要、分发等）
├── knowledge/
│   ├── raw/                  # 原始采集数据（HTML/JSON 快照，按日期归档）
│   └── articles/             # 结构化知识条目（一条一 JSON 文件）
├── src/                      # Hono 应用与采集/分析/分发逻辑
├── config/                   # 配置文件（API Key、渠道 Webhook 等，勿提交密钥）
└── tests/                    # 单元测试与 fixtures
```

**约定**

- `knowledge/raw/`：只追加、不覆盖；文件名建议 `{source}_{YYYY-MM-DD}.json`
- `knowledge/articles/`：每条知识一个文件，文件名 `{id}.json`
- Agent 逻辑放在 `.opencode/agents/`，通用能力封装为 `.opencode/skills/`

---

## 知识条目 JSON 格式

每条知识条目对应 `knowledge/articles/{id}.json`，字段如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 全局唯一 ID，建议 `{source}_{hash8}` 或 UUID |
| `title` | string | ✅ | 标题 |
| `source` | string | ✅ | 来源：`github_trending` \| `hacker_news` |
| `source_url` | string | ✅ | 原文链接 |
| `summary` | string | ✅ | AI 生成的中文摘要（100–300 字） |
| `tags` | string[] | ✅ | 标签，如 `["llm", "agent", "open-source"]` |
| `status` | string | ✅ | 生命周期：`draft` \| `reviewed` \| `published` \| `archived` |
| `author` | string | | 作者或仓库 maintainer |
| `published_at` | string | | 原文发布时间（ISO 8601） |
| `collected_at` | string | ✅ | 采集时间（ISO 8601） |
| `analyzed_at` | string | | AI 分析完成时间 |
| `raw_ref` | string | | 指向 `knowledge/raw/` 中原始文件的相对路径 |
| `score` | number | | 相关性评分 0–1 |
| `metadata` | object | | 扩展字段（stars、hn_points、repo_language 等） |

**示例**

```json
{
  "id": "hn_a3f2b1c8",
  "title": "LangGraph 1.0 发布：多 Agent 编排正式 GA",
  "source": "hacker_news",
  "source_url": "https://news.ycombinator.com/item?id=12345678",
  "summary": "LangGraph 1.0 正式发布，提供持久化状态、人机协作中断与可视化调试能力，适合构建生产级多 Agent 工作流。",
  "tags": ["langgraph", "agent", "workflow"],
  "status": "reviewed",
  "author": "dylan",
  "published_at": "2026-05-18T10:00:00Z",
  "collected_at": "2026-05-19T02:00:00Z",
  "analyzed_at": "2026-05-19T02:05:00Z",
  "raw_ref": "knowledge/raw/hn_2026-05-19.json",
  "score": 0.92,
  "metadata": {
    "hn_points": 342,
    "hn_comments": 89
  }
}
```

---

## Agent 角色概览

| 角色 | 目录 / 标识 | 职责 | 输入 | 输出 |
|------|-------------|------|------|------|
| **采集 Agent** | `.opencode/agents/collector` | 从 GitHub Trending、Hacker News 拉取原始条目，去重后写入 `knowledge/raw/` | 调度触发 / 配置中的关键词与语言过滤 | `knowledge/raw/{source}_{date}.json` |
| **分析 Agent** | `.opencode/agents/analyzer` | 读取原始数据，调用大模型生成摘要、标签、评分，判定是否与 AI/LLM/Agent 相关 | `knowledge/raw/` 中未处理条目 | `knowledge/articles/{id}.json`（`status: draft`） |
| **整理 Agent** | `.opencode/agents/curator` | 审核、合并重复、更新 `status`，触发 Telegram / 飞书分发 | `status: draft` 或 `reviewed` 的条目 | `status: published` 的条目 + 渠道推送记录 |

**协作流程**

```
采集 Agent → knowledge/raw/ → 分析 Agent → knowledge/articles/ → 整理 Agent → 多渠道分发
```

---

## 红线（绝对禁止）

以下操作在任何情况下 **不得** 执行：

1. **提交或硬编码密钥**：API Key、Bot Token、Webhook Secret、`.env` 内容不得写入代码库或日志
2. **覆盖 `knowledge/raw/` 历史文件**：原始采集数据只追加，禁止删除或覆盖已有归档
3. **未经审核直接 `published`**：分析 Agent 不得将条目设为 `published`；仅整理 Agent 在人工或规则审核后可发布
4. **向外部渠道发送未审核内容**：Telegram / 飞书推送前条目必须为 `reviewed` 或 `published`
5. **调试代码遗留主分支**：`console.log`、临时断点、注释掉的死代码不得合并
6. **绕过去重逻辑**：禁止为同一 `source_url` 创建多个 `id` 不同的条目
7. **修改他人 Agent 定义而不说明**：变更 `.opencode/agents/` 下其他角色的 prompt 或工具链时，必须在 PR / 提交说明中注明原因
8. **执行任意 shell / 未授权网络请求**：Agent 技能中禁止 `eval`、`Function` 构造器、未白名单的 `child_process` 或任意 URL 请求（仅允许配置的 GitHub、HN、模型 API、分发端点）
9. **删除 `knowledge/articles/` 中已 `published` 的条目**：归档请改 `status` 为 `archived`，不得物理删除
10. **在非 AI 领域内容上使用 `published`**：与 AI/LLM/Agent 无关的条目应标记为 `archived` 或丢弃，不得进入分发队列

---

## 开发与验证

- 本地开发：`pnpm dev`（Hono 开发服务器）
- 运行采集：`pnpm run collect -- --dry-run`
- 运行分析管道：`pnpm run analyze -- --input knowledge/raw/`
- 单元测试：`pnpm test`
- 提交前：`pnpm lint` 且 `pnpm test` 通过

如有与本文件冲突的临时需求，以项目负责人确认的书面说明为准，并应及时回写更新本文件。
