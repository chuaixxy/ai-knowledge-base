---
name: top-rated
description: 当用户要推荐/高分/最佳/best/score 最高的知识库文章时触发。典型用语：推荐几个/推荐 3 个/最值得看的/高分推荐/最佳文章/score 最高。不用于分类统计或日报。
allowed-tools:
  - Read
---

# 高分推荐

## 做法

1. Read knowledge/articles/index.json
2. 按 relevance_score 降序排序
3. 默认取 top 5(用户给数字就用用户的)
4. 去重(同一个 title 只保留 score 最高的一条)
5. 回复格式:
   ⭐ 高分推荐 top N:
   1. <title> · score <score> · <category>
      id: <id>

## 禁止

- 别 read 目录(EISDIR)
- 别返回低于 0.85 score 的
