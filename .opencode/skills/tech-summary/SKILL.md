---
name: tech-summary
description: 当需要对采集的技术内容进行深度分析总结时使用此技能。
permission:
  read: allow
  webfetch: allow
  bash: deny
  write: deny
  edit: deny
  glob: allow
  grep: allow
---

# Tech Summary Skill

## 使用场景

- 读取 `knowledge/raw/` 中最新采集文件，对每条内容做深度分析
- 用户问"帮我总结一下今天采集了什么"
- 用户问"最近有哪些技术趋势值得关注"
- 用户问"对这些内容做个质量评分和亮点提取"
- 配合 analyzer agent 作为标准化分析流程

## 约束

- 只读 `knowledge/raw/` 中的 JSON 文件，不做任何修改
- 禁止写入 `knowledge/articles/` 或修改原始数据
- 输出符合本技能定义的 JSON 结构

## 工作流程

### 1. 读取最新采集文件

```
Glob: knowledge/raw/*.json → 取最近修改的 1 个文件
Read: knowledge/raw/{latest_file}
```

读取后确认文件包含合法 JSON 且存在 `items` 数组。若文件为空或格式非法，直接返回空结果集。

### 2. 逐条深度分析

对每条 item 执行以下分析：

| 分析维度 | 要求 |
|---------|------|
| **摘要摘要** | 中文，不超过 50 字，概括核心价值 |
| **技术亮点** | 2-3 个，用事实和数据说话（如性能指标、架构创新、对比提升），不使用"具有重大意义"等空话 |
| **质量评分** | 1-10 整数，见评分标准 |
| **标签建议** | 2-5 个标签，优先从已有标签体系中选取（如 `llm`、`agent`、`rag`、`open-source`、`infra`、`frontend` 等）|

**评分标准：**

| 分数 | 含义 | 判定依据 |
|------|------|---------|
| 9-10 | 改变格局 | 发布新模型/架构/范式，引发行业讨论，有实测数据支撑 |
| 7-8 | 直接有帮助 | 解决实际工程问题，有可复用的代码/工具，性能提升显著 |
| 5-6 | 值得了解 | 概念/教程/综述，对拓宽视野有帮助 |
| 1-4 | 可略过 | 重复内容、营销文、信息量低、与 AI 相关性弱 |

**约束：** 一次分析的条目中，打 9-10 分的数量不得超过总条目数的 15%（向上取整）。例如 15 项中最多 2 个 9-10 分。

### 3. 趋势发现

分析全部条目后，归纳：

1. **共同主题**：出现在 3 条及以上条目中的重复主题（如"多 Agent 协作"、"RAG 优化"）
2. **新概念/工具**：首次出现或近期快速上升的概念、工具名、框架
3. **值得关注的原因**：每个主题 1-2 句说明为什么此刻值得关注

### 4. 输出

```json
{
  "source": "tech_summary",
  "analyzed_at": "2026-05-28T12:00:00Z",
  "raw_file": "knowledge/raw/hn_2026-05-28.json",
  "items_analyzed": 15,
  "results": [
    {
      "id": "gh_openbmb_pilotdeck",
      "title": "OpenBMB/PilotDeck",
      "source_url": "https://github.com/OpenBMB/PilotDeck",
      "summary": "轻量 MCP-over-HTTP 代理，支持多客户端会话隔离。",
      "highlights": [
        "支持 SSE 和流式响应，延迟较原生 MCP 降低 40%",
        "单进程可管理 100+ 独立会话，内存占用 <50MB",
        "兼容任意 MCP 客户端，无需修改服务端代码"
      ],
      "score": 8,
      "score_reason": "提供了立即可用的 MCP 基础设施优化方案，实测数据充分",
      "tags": ["mcp", "infra", "open-source"]
    }
  ],
  "trends": {
    "common_themes": [
      { "theme": "多 Agent 协作框架", "count": 4, "why_now": "生产环境对 Agent 间通信编排需求爆发，三周内出现 4 个相关项目" }
    ],
    "rising_concepts": ["MCP-over-HTTP", "Agent-as-a-Service"],
    "summary": "本周热点集中在 Agent 基础设施层，MCP 生态工具和记忆系统呈上升趋势。"
  }
}
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| `knowledge/raw/` 为空或无 JSON 文件 | 返回 `{ results: [], trends: null }`，不抛异常 |
| 单条数据解析失败（缺字段） | 跳过该条，继续处理其余条目 |
| 文件内容不是合法 JSON | 返回空结果，日志 warn |
| 全部失败 | 返回 `{ results: [], trends: null }`，不输出 error stack |
| 所有输出必须为合法 JSON | 任何失败路径都必须返回合法 JSON 结构 |

## 自测

### 正常运行

```
Read: knowledge/raw/{latest} 含 ≥ 10 条
→ 每条输出 summary / highlights / score / tags
→ 9-10 分数量 ≤ 15% 限制
→ trends.common_themes 至少 1 个
→ 输出合法 JSON
```

### 错误场景

| 测试 | 预期 |
|------|------|
| raw 目录为空 | 返回 `{ results: [], trends: null }` |
| 文件内容损坏 | 返回 `{ results: [], trends: null }` |
| 单条缺字段 | 跳过该条，其余正常输出 |
| 输出验证 | 最终输出始终是合法 JSON |

## 验收标准

- [ ] 成功读取最新采集文件
- [ ] 每条必填字段完整（summary / highlights / score / score_reason / tags）
- [ ] summary ≤ 50 字
- [ ] highlights 2-3 条，均有事实或数据支撑
- [ ] score 遵循评分标准，9-10 不超过 15%
- [ ] trends 包含 common_themes 和 rising_concepts
- [ ] 输出为合法 JSON
