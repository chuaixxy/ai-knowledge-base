---
name: category-summary
description: 当用户询问某个分类/类别有多少篇文章，或要看某类的 top 文章时触发。典型用语：framework 类有多少/framework 类有多少篇/agent 类几篇/tool 类有几篇/tool 类 top 5/有哪些 RAG 相关/xx 类文章。不用于全库推荐（走 top-rated）或日报（走 daily-digest）。
allowed-tools:
  - Read
---

# 分类汇总

## 做法

1. Read `knowledge/articles/index.json`，一次读完，不要 glob/grep 文件

2. **模糊匹配分类**：用户给的词（如 "framework"、"agent"、"rag"）与每条记录的 `category` 字段做大小写不敏感的子串匹配，同时匹配 `tags` 数组
   - 例：用户说 "framework 类" → 匹配 category 含 "framework"、"框架" 的所有记录，以及 tags 含 "framework" 的记录

3. **统计总数**：命中记录的总条数

4. **取 top 5**：命中记录按 `relevance_score` 降序，取前 5 条

5. **回复格式**：
   ```
   📂 <用户关键词> 类：共 N 篇

   Top 5：
   1. <title> · score <score>
      id: <id>
   2. ...
   ```
   若命中 0 条，回复"未找到 xx 类文章，当前库中有：<列出所有不重复 category>"

## 禁止

- 别 read 单篇文章文件（index.json 已有足够字段，无需读全文）
- 别精确匹配 category 字符串（用户说的词和库里的不一定完全一致）
- 别跳过 tags 匹配（有些文章 category 是中文但 tags 有英文关键词）
- 别返回 score 低于 0.6 的
