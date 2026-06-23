# GitHub Trending Skill — Spec

## 使用场景

- 每日定时采集 GitHub Trending 当日热门项目
- 用户问"今天 GitHub 有什么热门项目"
- 用户问"最近有什么火的 AI 开源项目"
- 用户问"GitHub 上 stars 涨得最快的项目"
- 配合 collector agent 作为数据源之一

## Overview

从 GitHub Trending 官网（https://github.com/trending）采集当日 AI/LLM/Agent/Frontend 相关的热门仓库，输出结构化 JSON。

## Constraints

- 只能使用 `WebFetch` 工具，禁止 Bash / 脚本执行
- 不调 GitHub API（避 rate limit）
- 输出符合 `specs/schemas/collector-output.json` 格式契约

## WebFetch Target

- URL: `https://github.com/trending?since=daily`
- Accept: `text/html`
- 频率：单次请求，不留缓存

## HTML 解析策略

GitHub Trending 页面为服务端渲染 HTML，repo 卡片结构如下（简化）：

```html
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/owner/repo">owner / <strong>repo</strong></a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">
    repo description text
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block ml-0 mr-3">
      <span class="repo-language-color" style="background-color: #xxx"></span>
      Language
    </span>
    <a href="/owner/repo/stargazers">
      <svg .../> <strong>n</strong> stars
    </a>
    <a href="/owner/repo/forks">
      <svg .../> <strong>n</strong> forks
    </a>
    <span class="d-inline-block float-sm-right">
      <svg .../> n stars today
    </span>
  </div>
</article>
```

### 提取字段

| 字段 | 提取方式 |
|------|----------|
| `title` | `h2 a` 的文本，格式 `owner/repo` |
| `source_url` | `h2 a` 的 `href`，拼接 `https://github.com` |
| `language` | `.d-inline-block.ml-0.mr-3` 中 language 文本 |
| `stars_total` | `a[href$="/stargazers"] strong` 的文本 |
| `stars_today` | `float-sm-right` 内的数字 |
| `forks` | `a[href$="/forks"] strong` 的文本 |
| `description` | `p.col-9` 的文本 |

## 过滤逻辑

AI 关键词（大小写不敏感）：

```
ai, llm, agent, ml, machine-learning, deep-learning,
neural, gpt, claude, openai, anthropic, mistral,
transformer, model, inference, embedding, vector,
rag, fine-tune, fine-tuning, chatbot, autonomous,
diffusion, stable-diffusion, llama, gemini, copilot,
langchain, llamaindex, open-source-ai
```

前端关键词：

```
frontend, react, vue, angular, svelte, nextjs,
tailwind, css, html, javascript, typescript,
ui, ux, component, design-system
```

检查范围：`topics` → `description` → `name`。匹配任一关键词即保留。

## 排序

按 `stars_today`（当日新增 stars）从高到低，取 top 50。

## 输出格式

```json
{
  "source": "github_trending",
  "collected_at": "2026-05-20T00:00:00Z",
  "items": [
    {
      "id": "gh_owner_repo",
      "title": "owner/repo",
      "source_url": "https://github.com/owner/repo",
      "source": "github_trending",
      "topic": "ai | frontend",
      "stars": 1234,
      "summary": "Agent 翻译的中文摘要",
      "description": "英文原文描述",
      "collected_at": "2026-05-20T00:00:00Z",
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

说明：
- `stars` = 当日新增 stars（stars_today），与 trending 页面排序一致
- `metadata.stars_total` = 仓库总 stars
- 未命中过滤条件的条目丢弃

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

- [ ] WebFetch 单次请求成功，解析正确
- [ ] 每条记录 `id` / `title` / `source_url` / `source` / `topic` / `stars` / `summary` / `collected_at` 均已填写
- [ ] `topic` 仅含 `ai` 或 `frontend`
- [ ] 按 `stars` 从高到低排序
- [ ] 无重复 URL
- [ ] 过滤后条目数 ≥ 15
