# Issue #02 · Analyzer Agent

> Week 1 · 第 3 节 · to-issues 展开产物
> 源自 [../agents-prd.md](../agents-prd.md)

## Depends on

- [#01 · Collector Agent](./01-collector.md) — 须等 `knowledge/raw/{date}.collector.done` 存在

## Description

读取 `knowledge/raw/` 中的当日原始采集数据，对每条内容打三维标签（领域 / 技术 / 类型），生成精炼摘要与相关性评分，写入 `knowledge/articles/{id}.json`。

## Trigger

- 检测到 `knowledge/raw/{date}.collector.done` 后自动触发
- 或手动运行 `pnpm run analyze -- --date 2026-05-20`

## Acceptance Criteria

### 数据契约

- [ ] 输出符合 [../schemas/analyzer-output.json](../schemas/analyzer-output.json) JSON Schema
- [ ] 字段在 collector 输出基础上补充：`highlights` / `score` / `analyzed_at`（`tags` 继承自 collector）
- [ ] `score` 为 1-10 整数，分布合理（不能全是高分）
- [ ] `highlights` 每条 2-3 项，每项不超过 30 字
- [ ] `tags` 每条 2-5 个，覆盖技术栈 / 主题 / 类型三维
- [ ] 文件路径：`knowledge/articles/{id}.json`（每条记录一个文件）

### 上游依赖检查

- [ ] 执行前检查 `knowledge/raw/{date}.collector.done` 是否存在
- [ ] 不存在则标记 `knowledge/workflow/{date}.analyzer.skipped` 并退出，不执行任何分析

### 完成标记

- [ ] 全部条目写完后 `touch knowledge/articles/{date}.analyzer.done`
- [ ] `.done` 文件是下游 organizer 的触发信号

### 失败处理

- [ ] 单条目分析失败跳过该条目，继续处理其余条目
- [ ] 最终有失败条目时写 `knowledge/articles/{date}.analyzer.failed`
- [ ] 写入 `knowledge/incidents/{date}-analyzer.md` 记录失败条目列表供人工复核

### 幂等性

- [ ] 执行前检查 `.done` 文件 · 存在则跳过
- [ ] `--force` 先删除 `.done` / `.failed` / `.skipped` 再执行

### 可观测性

- [ ] 启动 / 结束写 `knowledge/logs/{date}-analyzer.log`
- [ ] 日志含 `start_ts` / `end_ts` / `input_count` / `output_count` / `skipped_count` / `failed_count`
