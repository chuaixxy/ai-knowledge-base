# AI 知识库 · 三 Agent PRD

> Week 1 · 第 1 节 · 高阶设计文档
> 先写这份 PRD 明确协作意图，再用 `to-issues` 展开成带 `depends_on` + `acceptance` 的任务票（见 [.issues/](./.issues/)）。

## 总流程

每天 UTC 0:00 触发 · `collector → analyzer → organizer` 串行执行。

## Agent 职责

- **collector**: 抓 GitHub Trending / Hacker News / 微信公众号 / 稀土掘金 · 过滤 AI / 前端相关内容 · 存 `knowledge/raw/{source}_{date}.json`
- **analyzer**: 读 raw · 给每条打 3 维度标签（领域 / 技术 / 类型）· 生成摘要与相关性评分 · 存 `knowledge/articles/{id}.json`
- **organizer**: 读已分析条目 · 按日期/标签聚合 · 整理成 `knowledge/reports/daily_{date}.md`

## 开放问题（用 to-issues 展开为带 depends_on + acceptance 的任务票）

- 上游失败下游怎么办？
- 数据怎么传？文件标记 or 消息队列？
- 重跑策略？
- 进度追踪？

## 非功能约束

- **幂等性**: 每个 Agent 执行前先检查 `.done` 文件 · 存在则跳过
- **强制重跑**: `--force` 参数可强制重跑 · 会先删除所有 `.done`/`.failed` 标记
- **数据源**: JSON Schema 放 `specs/schemas/` · 作为 Agent 间契约的可执行真相源
- **串行策略**: 上游失败 → 下游标记为 `skipped` · 不执行

## 选型说明

- **done 文件用 `touch` 不用 SQLite**: v1 文件就是真相源 · 不引入数据库依赖 · 便于人工排查
- **串行不并行**: 三个 Agent 输出量不大 · 串行足够 · 降低复杂度 · 失败路径清晰
- **共享模块前置**: 幂等性、错误处理、日志系统作为 #01 基础设施 · 供所有 Agent 复用

## 目录约定

```
knowledge/
├── raw/                    # collector 输出 · 原始数据
├── articles/               # analyzer 输出 · 知识条目
├── reports/                # organizer 输出 · 日报
├── logs/                   # 执行日志
├── workflow/               # 工作流状态
└── incidents/              # 失败记录供人工复核
```

---

**下一步**：运行 `to-issues` 展开为 [issues/01-collector.md](./issues/01-collector.md) / [issues/02-analyzer.md](./issues/02-analyzer.md) / [issues/03-organizer.md](./issues/03-organizer.md) 三份任务票。每份 issue 自带 `depends_on` / `acceptance` / 对应 schema，组合起来就是完整的协作契约。

每份 issue 自带 `depends_on` / `acceptance` / 对应 schema，组合起来就是完整的协作契约。
