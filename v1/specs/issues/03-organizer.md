# Issue #03 · Organizer Agent

> Week 1 · 第 3 节 · to-issues 展开产物
> 源自 [../agents-prd.md](../agents-prd.md)

## Depends on

- [#02 · Analyzer Agent](./02-analyzer.md) — 须等 `knowledge/articles/{date}.analyzer.done` 存在

## Description

读取 `knowledge/articles/` 中当日已分析条目，按日期 / 标签聚合，整理生成 `knowledge/reports/daily_{date}.md` 日报。

## Trigger

- 检测到 `knowledge/articles/{date}.analyzer.done` 后自动触发
- 或手动运行 `pnpm run organize -- --date 2026-05-20`

## Acceptance Criteria

### 数据契约

- [ ] 输出为 Markdown，路径：`knowledge/reports/daily_{YYYY-MM-DD}.md`
- [ ] 日报结构包含：日期标题 / AI 分区 / 前端分区 / 每条含标题+链接+摘要+亮点+评分
- [ ] 分区内条目按 `score` 从高到低排序
- [ ] 仅包含当日 `collected_at` 的条目，不混入历史数据

### 上游依赖检查

- [ ] 执行前检查 `knowledge/articles/{date}.analyzer.done` 是否存在
- [ ] 不存在则标记 `knowledge/workflow/{date}.organizer.skipped` 并退出，不生成日报

### 完成标记

- [ ] 日报写完后 `touch knowledge/reports/{date}.organizer.done`
- [ ] 标志整条流水线当日执行完成

### 失败处理

- [ ] 聚合失败写 `knowledge/reports/{date}.organizer.failed`
- [ ] 写入 `knowledge/incidents/{date}-organizer.md` 供人工复核
- [ ] 已写入的部分日报文件需清理，避免输出残缺文件

### 幂等性

- [ ] 执行前检查 `.done` 文件 · 存在则跳过
- [ ] `--force` 先删除 `.done` / `.failed` / `.skipped` 再执行

### 可观测性

- [ ] 启动 / 结束写 `knowledge/logs/{date}-organizer.log`
- [ ] 日志含 `start_ts` / `end_ts` / `input_count` / `ai_count` / `frontend_count`
