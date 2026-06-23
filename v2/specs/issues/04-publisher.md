# Issue #04 · Publisher Agent

> 源自 [AGENTS.md](../../AGENTS.md) · 依赖 #03

## Allowed Tools

- **Read** — 读取 `index.json` 和 articles 文件
- **Grep / Glob** — 查找文件
- **禁止 Write / Edit** — 不修改任何文件
- **禁止 WebFetch** — 不访问外部
- **禁止 Bash** — 不执行 shell 命令

## What to build

读取 `knowledge/articles/index.json`，过滤当天已发布条目，按源分组生成中文摘要报告回复用户。只读不写，流水线终点。

核心行为：
- 读取 index.json，筛选 `status == "published"` 且 `collected_at` 日期为当天的条目
- 按 source 分组（GitHub Trending / Hacker News / arXiv）
- 生成中文日报：概览（采集总数 / 合格发布数） + 按源分组条目列表 + 标签云
- 每个条目展示：标题、摘要、评分、标签、链接
- 已归档条目（`archived`）不纳入日报
- 当天无发布条目时汇报「今日暂无新内容」

### 输出报告格式示例

```
# AI 知识库日报 — 2026-06-23

今日共采集 50 条，合格发布 12 条。

## 🔥 GitHub Trending（5 条）

1. **OpenAI Agents SDK** ⭐ 0.87
   OpenAI 官方发布的 Agent 开发 SDK，提供任务交接、工具调用与安全护栏等核心原语...
   📎 https://github.com/openai/agents-sdk
   🏷️ agent-framework, multi-agent, python, openai

2. ...

## 📰 Hacker News（4 条）
...

## 📄 arXiv（3 条）
...

---

🏷️ 今日高频标签：agent-framework(5), python(4), openai(3), multi-agent(3)
```

## Acceptance criteria

- [ ] 正确筛选当天 `status == "published"` 且 `collected_at` 日期为当天的条目
- [ ] 按 source 分组（github-trending / hackernews-top / arxiv）
- [ ] 日报包含：概览统计、按源分组的条目列表、标签云
- [ ] 每个条目显示标题、摘要、评分、标签、完整链接
- [ ] `archived` 状态条目不出现在日报中
- [ ] 当天无发布内容时输出「今日暂无新内容」
- [ ] 摘要简洁，链接完整
- [ ] 只读操作，不修改任何文件（index.json、articles 文件均不写）

## Notes

- 采集总数 = index.json 中当天 `collected_at` 的所有条目（含未发布和已发布的）
- 合格发布数 = 当天 `status == "published"` 的条目数
- 同日多次运行 Publisher，应产生相同报告（幂等）
- 标签云按频次排序，频次相同的按字母排序
- 如果当天 index 中没有任何条目（从未采集），也输出「今日暂无新内容」

## Blocked by

- #03 — 需要 index.json 中有当天 `published` 状态的条目
