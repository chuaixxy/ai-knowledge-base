---
name: github-trending
description: 从 GitHub Trending 采集 AI/Frontend 热门仓库。Use when user asks about GitHub trending, 热门仓库, trending repos, 抓取/爬 GitHub 排行, "今天 GitHub 流行什么".
permission:
  read: allow
  webfetch: allow
  bash: deny
  write: deny
  edit: deny
  glob: deny
  grep: deny
---

# GitHub Trending Skill

## 使用场景

- 每日定时采集 GitHub Trending 当日热门项目
- 用户问"今天 GitHub 有什么热门项目"
- 用户问"最近有什么火的 AI 开源项目"
- 用户问"GitHub 上 stars 涨得最快的项目"
- 配合 collector agent 作为数据源之一

## 约束

- 只能用 `WebFetch`，禁止 Bash / 脚本执行
- 不调 GitHub API
- 输出符合 `specs/schemas/collector-output.json`

## 工作流程

### 1. 抓取页面

```
WebFetch: https://github.com/trending?since=daily
```

### 2. 解析 HTML

每个 repo 卡片为 `<article class="Box-row">`，提取：

| 字段 | 提取方式 |
|------|----------|
| `title` | `h2.lh-condensed a` 文本，格式 `owner/repo` |
| `source_url` | 同上 `href`，拼接 `https://github.com` |
| `description` | `p.col-9.color-fg-muted` 文本 |
| `language` | `.d-inline-block.ml-0.mr-3` 文本（去颜色标记） |
| `stars_total` | `a[href$="/stargazers"] strong` 文本 |
| `stars_today` | `float-sm-right` 内数字 |
| `forks` | `a[href$="/forks"] strong` 文本 |
| `is_fork` | 检查卡片内是否有 fork 标记（如 `"forked from"` 文本），有则标记为 fork |

### 3. 过滤

对每一条解析后的 repo，执行两层过滤：

**第一层：质量过滤（硬性排除）**

满足以下任一条件的仓库直接丢弃，不再进入 topic 分类：

| 排除条件 | 判定依据 |
|----------|---------|
| Fork 仓库 | 卡片内包含 `"forked from"` 文本 |
| 链接集合 | description/name 包含 `list`, `awesome`, `collection`, `resource`, `guide`, `tutorial`, `links`, `bookmark` 等关键词 |
| 课程作业 | description/name 包含 `homework`, `assignment`, `lab`, `course`, `lecture`, `exercise` 等关键词 |
| 个人笔记 | description/name 包含 `note`, `notes`, `cheat-sheet`, `learning`, `study` 等关键词（除非是教程型项目本身） |

**第二层：LLM 分类（取代关键词匹配）**

对通过质量过滤的仓库，由 LLM 根据 `title` + `description` 判断分类：

```
判断依据：
- title 中的 owner/repo 名称
- description 全文
- 编程语言（如 Python 常见于 AI，TypeScript 常见于前端等）

输出以下三者之一：
- "ai"     → 与 AI/LLM/Agent/ML/DL 相关的工具、框架、模型、应用
- "frontend" → 与前端/UI/UX/React/Vue 等前端技术相关的工具、库、组件
- null     → 与以上两者都无关，丢弃
```

规则：
- `topic` 为 `ai` 和 `frontend` 互斥，优先命中 `ai`（既是 AI 工具又有前端界面的，标为 `ai`）
- 严格区分：通用编程工具（如 linter、formatter、CI/CD）如果没有明确的 AI 或前端属性，应归为 null

### 4. 排序 & 截断

按 `stars_today` 从高到低，取 top 50。
LLM 分类后不足 15 条时，以实际条数输出，不补。

### 5. 输出

```json
{
  "source": "github_trending",
  "collected_at": "2026-05-28T12:00:00Z",
  "items": [
    {
      "id": "gh_owner_repo",
      "title": "owner/repo",
      "source_url": "https://github.com/owner/repo",
      "source": "github_trending",
      "topic": "ai",
      "stars": 1234,
      "summary": "Agent 翻译的中文摘要",
      "description": "英文原文描述",
      "collected_at": "2026-05-28T12:00:00Z",
      "tags": [],
      "metadata": {
        "language": "Python",
        "stars_total": 50000,
        "stars_today": 1234,
        "forks_count": 1200
      }
    }
  ]
}
```

`stars` = 当日新增 stars（与页面排序一致）。页面文本格式为 `"1,234 stars today"`，需去掉逗号取整数 → `1234`。

### 6. ID 生成规则

```
id = "gh_" + owner + "_" + repo
将 / 和 - 替换为 _
全部转小写
```

示例：`OpenBMB/PilotDeck` → `gh_openbmb_pilotdeck`

## 质量标准

- 采集条目数：15-30 条为正常范围
- 少于 10 条：关键词可能需要扩展，报告给用户
- 多于 50 条：过滤条件可能太宽松，提高 Star 阈值

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| HTTP 超时（>10s） | 返回 `{ source: "github_trending", collected_at: "...", items: [] }`，不抛异常 |
| 网络错误 / 非 200 | retry 3 次，指数退避（1s / 4s / 16s）；最终失败返回空数组 |
| HTML 结构变化导致解析失败 | 日志 warn，返回 `{ source: "github_trending", collected_at: "...", items: [] }` |
| 单条解析失败 | 跳过该条，继续处理其余条目 |
| 绝不输出非 JSON 内容 | 任何失败路径都必须返回合法 JSON 结构，不输出 error stack 或纯文本 |

## 自测

### 正常运行

```
WebFetch: https://github.com/trending?since=daily
→ status 200, HTML 含 ≥ 25 个 <article class="Box-row">
→ 质量过滤（排除 fork/集合/课程/笔记）
→ LLM 分类后 ≥ 10 条, topic 仅含 ai/frontend
→ 输出合法 JSON, 每字段填写完整
```

### 错误场景

| 测试 | 预期 |
|------|------|
| 超时（模拟网络断开） | 返回 `{ items: [] }`，无异常 |
| 空响应（模拟 204） | 返回 `{ items: [] }` |
| 结构变化（模拟未知 HTML） | 日志 warn，返回 `{ items: [] }` |
| LLM 分类全部为 null | 返回 `{ items: [] }`（不超过错） |
| 输出验证 | 最终输出始终是合法 JSON |

## 验收标准

- [ ] WebFetch 请求成功，解析无报错
- [ ] 每条记录必填字段完整
- [ ] `topic` 仅含 `ai` / `frontend`，无遗漏无关仓库
- [ ] 无 fork 仓库、无链接集合、无课程作业、无个人笔记
- [ ] 按 `stars` 降序
- [ ] 无重复 URL
