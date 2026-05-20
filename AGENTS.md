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

### 1. 命名规范

| 场景 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `github-api.ts`, `article-service.ts` |
| TypeScript 类型/类 | PascalCase | `interface KnowledgeArticle`, `class AppError` |
| 变量、导出函数 | camelCase | `const sourceUrl`, `export function fetchTrending()` |
| 模块内部函数 | camelCase | `function parseHtml()` |
| JSON 字段 | snake_case | `{ "source_url": "...", "collected_at": "..." }` |
| 数据库列名 | snake_case | `created_at`, `updated_at` |
| 环境变量 | SNAKE_CASE | `GITHUB_TOKEN`, `LOG_LEVEL` |

**跨层命名转换**：数据库列名（snake_case）↔ TypeScript 类型（camelCase）↔ API JSON（snake_case）由序列化层自动转换，禁止在业务代码中手写 mapper。

### 2. 文档规范

采用 **Google 风格** JSDoc / TSDoc，`@param` 以名词短语开头，不加 "The"。

**正确示例：**
```typescript
/**
 * 从 GitHub Trending 拉取指定语言的仓库列表。
 *
 * @param language - 编程语言筛选，默认 "python"。
 * @returns 仓库元数据列表。
 * @throws 当 API 限流时抛出 AppError。
 */
export async function fetchTrendingRepos(
  language: string = "python",
): Promise<TrendingRepo[]> {
  // ...
}
```

**错误示例：**
```typescript
/**
 * @param language This is the parameter for filtering language.
 */
```

### 3. 日志规范

使用统一 logger（如 `pino`），禁止 `console.log`。

```typescript
// 正确
logger.info({ language }, 'fetching trending repos');
logger.error({ err }, 'failed to fetch repos');

// 禁止
console.log('fetching trending repos');
```

**ESLint 配置**：`'no-console': ['error', { 'allow': ['warn', 'error'] }]`

- 保留 `console.warn/error` 给紧急场景
- 开发调试用 `logger.debug()`，配合 `LOG_LEVEL=debug`
- 提交前自动修复：`npm run lint:fix`

### 4. 类型规范

公共 API 必须定义 TypeScript interface / type，明确区分**必填**和**可选**字段。

```typescript
interface KnowledgeArticle {
  id: string;           // 必填
  author?: string;      // 可选
}
```

JSON 数据使用 **Zod** 做运行时校验，并自动转换字段名：

```typescript
const KnowledgeArticleSchema = z.object({
  source_url: z.string(),  // JSON 中是 snake_case
}).transform((data) => ({
  ...data,
  sourceUrl: data.source_url,  // 转换为 camelCase
}));
```

**兼容性**：新增字段必须是可选的（`?`），禁止修改已存在的必填字段类型。

### 5. 依赖管理

新增依赖需在 **PR 描述** 中说明：
- 依赖名称和版本
- 用途说明
- 是否评估过替代方案

**核心/高风险依赖**（爬虫、加密、数据库）额外写入 `DEPENDENCIES.md`。

### 6. 测试规范

| 类型 | 位置 | 命名 |
|------|------|------|
| 单元测试 | 与源码平行 | `*.test.ts` |
| 集成测试 | `tests/integration/` | `*.e2e.test.ts` |
| 测试数据 | `tests/fixtures/` | - |

外部 HTTP 请求统一使用 **MSW** 拦截，禁止测试直接调用真实服务。

### 7. 错误处理

统一使用 `AppError` 类：

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
  }
}
```

API 错误响应格式：
```json
{ "success": false, "error": { "code": "GITHUB_API_ERROR", "message": "无法获取数据" } }
```

### 8. 调试代码红线

以下代码**绝对禁止**遗留主分支：

| 禁止项 | 示例 |
|--------|------|
| `console.log` | `console.log('debug:', data)` |
| 注释掉的测试 | `// it('should work', () => {` |
| 临时的 TODO | `// TODO: fix this` |
| 性能测试 | `console.time('fetch'); ... console.timeEnd('fetch')` |
| 临时断点 | `debugger;` |

**允许的例外**：带 Issue 编号的 TODO：`// TODO(#123): 说明内容`（PR 描述需说明关联 Issue）

### 9. 代码格式

代码格式遵循项目根目录 `.prettierrc` 配置，提交前自动格式化。

- **ESLint + lint-staged**：pre-commit 时自动修复
- **npm 脚本**：`npm run lint:fix` 供开发时自查
- **CI 检查**：所有 PR 必须通过 `pnpm lint`

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
