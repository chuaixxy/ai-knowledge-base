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

### 3. 过滤

检查 `description` / `name` 是否包含以下关键词（大小写不敏感，trending 页面不显示 topics）：

AI 关键词：`ai, llm, agent, ml, machine-learning, deep-learning, neural, gpt, claude, openai, anthropic, mistral, transformer, model, inference, embedding, vector, rag, fine-tune, fine-tuning, chatbot, autonomous, diffusion, stable-diffusion, llama, gemini, copilot, langchain, llamaindex, open-source-ai`

前端关键词：`frontend, react, vue, angular, svelte, nextjs, tailwind, css, html, javascript, typescript, ui, ux, component, design-system`

### 4. 排序 & 截断

按 `stars_today` 从高到低，取 top 50。

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
→ 过滤后 ≥ 15 条, stars 为当日新增
→ 输出合法 JSON, 每字段填写完整
```

### 错误场景

| 测试 | 预期 |
|------|------|
| 超时（模拟网络断开） | 返回 `{ items: [] }`，无异常 |
| 空响应（模拟 204） | 返回 `{ items: [] }` |
| 结构变化（模拟未知 HTML） | 日志 warn，返回 `{ items: [] }` |
| 输出验证 | 最终输出始终是合法 JSON |

## 验收标准

- [ ] WebFetch 请求成功，解析无报错
- [ ] 每条记录必填字段完整
- [ ] `topic` 仅含 `ai` / `frontend`
- [ ] 按 `stars` 降序
- [ ] 无重复 URL
- [ ] 过滤后 ≥ 15 条
