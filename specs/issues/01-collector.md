# Issue #01 · Collector Agent

> Week 1 · 第 3 节 · to-issues 展开产物
> 源自 [../agents-prd.md](../agents-prd.md) · 上游无依赖

## Depends on

（无 · collector 是流水线起点）

## Description

从 GitHub Trending / Hacker News / 稀土掘金 / 微信公众号四路采集 AI 和前端技术动态，过滤无关内容，写入 `knowledge/raw/{source}_{date}.json`。

## Trigger

- 每天 UTC 0:00 由 cron 触发
- 或手动运行 `pnpm run collect -- --date 2026-05-20`

## Acceptance Criteria

### 数据契约

- [ ] 输出符合 [../schemas/collector-output.json](../schemas/collector-output.json) JSON Schema
- [ ] 字段至少包含：`source` / `source_url` / `title` / `popularity` / `topic` / `summary` / `collected_at`
- [ ] `topic` 仅含 `ai` 或 `frontend`
- [ ] 文件路径：`knowledge/raw/{source}_{YYYY-MM-DD}.json`（每个来源一个文件）
- [ ] 每个文件条目数 >= 15

### 完成标记

- [ ] 全部来源写完后 `touch knowledge/raw/{date}.collector.done`
- [ ] `.done` 文件是下游 analyzer 的触发信号

### 失败处理

- [ ] 单来源抓取失败 retry 3 次（指数退避 1s / 4s / 16s）
- [ ] 最终失败写 `knowledge/raw/{date}.collector.failed`
- [ ] 失败不触发下游，由 failure SOP 处理
- [ ] 写入 `knowledge/incidents/{date}-collector.md` 供人工复核

### 幂等性

- [ ] 执行前检查 `.done` 文件 · 存在则跳过
- [ ] `--force` 先删除 `.done` / `.failed` 再执行

### 可观测性

- [ ] 启动 / 结束写 `knowledge/logs/{date}-collector.log`
- [ ] 日志含 `start_ts` / `end_ts` / `source` / `item_count` / `filtered_count`
