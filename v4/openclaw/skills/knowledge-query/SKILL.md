---
name: knowledge-query
description: 当用户要搜索/查找/查询知识库文章时触发。典型用语：搜索 MCP/查找 agent 相关/找一下 RAG 文章/search xxx/关于 xxx 有什么/找 #tag 标签文章/#tag 标签文章。不用于查看简报（走 daily-digest）或推荐排行（走 top-rated）。
allowed-tools:
  - Read
---

# 知识库检索

## 解析规则

从用户输入中提取两类参数：

| 参数 | 提取方式 | 示例 |
|---|---|---|
| `#tag` 标签 | 匹配所有 `#xxx` token，去掉 `#` 号 | `#rag #mcp` → tags: ["rag","mcp"] |
| 关键词 keyword | 去掉所有 `#xxx` 后剩余的文字 | `搜索 agent 框架 #rag` → keyword: "agent 框架" |

两类参数可同时存在，也可只有其中一种。

## 检索流程

### Step 1 · 只读索引

`Read knowledge/articles/index.json`，一次读完。

> 不要 Glob/Grep 扫文件名——index.json 已含所有元信息。

### Step 2 · 内存过滤（按以下顺序依次应用）

**关键词过滤**（有 keyword 时执行）：
- 匹配字段：`title`、`summary`、`key_insight`、`tags` 数组
- 大小写不敏感（统一转小写后 `includes`）

**标签过滤**（有 `#tag` 时执行，OR 语义）：
- article.tags 数组中至少一个与用户 tags 完全匹配（小写）

**日期过滤**（用户明确提到时间时执行）：
- 用 `collected_at ?? id` 的前 10 位（YYYY-MM-DD）与 dateFrom / dateTo 比较
- 今天 → dateFrom = dateTo = 今日日期
- 本周 → dateFrom = 7 天前

**评分过滤**：丢弃 `relevance_score < 0.5` 的条目

### Step 3 · 排序 + 截取

- 按 `relevance_score` 降序排列
- 默认取 top 5；用户给了数字就用用户的（上限 20）

### Step 4 · 按需读全文

只有用户要看 `summary` / `url` / `key_insight` 时，才 `Read knowledge/articles/{id}.json`。

> index.json 里已有 title / tags / score / category / collected_at，不要为了输出这些字段多余地读全文。

## 输出格式

```
🔍 找到 N 条与「<query>」相关的内容：

📌 1. **<title>**
   <summary 前 80 字>...
   📊 <score> | <source> | <date> | <tag1>, <tag2>, <tag3>
   🔗 <url>

📌 2. ...
```

**无结果时**：
```
🔍 未找到与「<query>」相关的内容。
💡 试试换个关键词，或去掉时间限制。
```

## 禁止

- 别批量 Read 所有文章文件（上下文有限，只按需读）
- 别用 Glob/Grep（index.json 已经是索引，直接内存筛）
- 别返回 score < 0.5 的条目
- 别把 `#tag` 里的 `#` 号带进关键词搜索
