---
name: subscribe-tag
description: 当用户要订阅或取消订阅某个标签/主题时触发。典型用语："订阅 RAG 标签"、"关注 agent 类"、"取消订阅 mcp"、"我想收到 framework 相关推送"、"不要再推 tool 了"。不用于搜索文章或查看简报。
allowed-tools:
  - Read
  - file_write
---

# 标签订阅管理

## 数据结构

订阅文件路径：`kb/subscriptions/<user_id>.json`

```json
{
  "user_id": "<user_id>",
  "tags": ["rag", "agent"],
  "updated_at": "2026-07-08T00:00:00Z"
}
```

## 做法

### 订阅流程

1. 从对话上下文取 `user_id`；若取不到，使用 `"default"`
2. `Read kb/subscriptions/<user_id>.json`，若文件不存在则视为 `{ "tags": [] }`（不要报错）
3. 提取用户给出的标签词，统一转小写
4. 将新标签合并到现有 `tags` 数组（去重）
5. `file_write kb/subscriptions/<user_id>.json` 写入更新后的 JSON，`updated_at` 用当前 ISO 时间
6. 回复格式：
   ```
   ✅ 已订阅标签：<新增标签>
   当前订阅：<全部标签列表>
   ```

### 取消订阅流程

1–2. 同上
3. 从 `tags` 数组移除用户指定的标签
4. `file_write` 写回
5. 回复格式：
   ```
   🗑️ 已取消订阅：<移除标签>
   当前订阅：<剩余标签列表>（若为空则显示"暂无订阅"）
   ```

### 查看订阅流程

用户说"我订阅了什么"/"查看我的订阅"时：
1. `Read kb/subscriptions/<user_id>.json`
2. 列出 `tags`，若为空回复"暂无订阅"

## daily-digest 集成说明

`daily-digest` skill 执行时，若存在 `kb/subscriptions/<user_id>.json`，
可在 Step 2 过滤阶段优先展示订阅标签命中的文章（`tags` 字段与订阅标签有交集）。

## 禁止

- 别读 `knowledge/articles/` 目录（本 skill 只管订阅文件）
- 别创建 `kb/subscriptions/` 目录本身（`file_write` 会自动创建路径）
- 别把标签存成大写（统一小写，便于后续匹配）
- 别覆盖 `user_id` 和 `updated_at` 以外的字段（保持 JSON 结构稳定）
