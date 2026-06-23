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
| **标签建议** | 2-5 个标签，优先从已有标签体系中选取（如 `llm`、`agent`、`rag`、`open-source`、`infra` 等）|

**好的摘要示例：**

- `轻量 MCP-over-HTTP 代理，支持多客户端会话隔离，适合把本地 Agent 工具稳定接入 Web 环境。`
- `多 Agent 工作流框架，强调状态管理与任务编排，适合作为生产级 Agent 系统参考。`

**坏的摘要示例：**

- `这是一个很厉害的 AI 项目。`
- `本文介绍了一个工具。`
- `比较有帮助，值得关注。`

**标签词库**（优先使用，保持一致性）：

- 领域：`large-language-model`, `agent-framework`, `rag`, `mcp`, `fine-tuning`, `prompt-engineering`, `multi-agent`, `code-generation`
- 技术：`transformer`, `attention`, `embedding`, `vector-database`, `knowledge-graph`
- 工具：`langchain`, `llamaindex`, `openai`, `anthropic`, `deepseek`, `huggingface`
- 场景：`chatbot`, `code-assistant`, `data-analysis`, `document-qa`, `workflow-automation`

如果条目涉及词库中没有的概念，可以新增标签，但必须遵循英文小写连字符格式。

**评分标准：**

| 分数 | 含义 | 判定依据 |
|------|------|---------|
| 9-10 | 改变格局 | 发布新模型/架构/范式，引发行业讨论，有实测数据支撑 |
| 7-8 | 直接有帮助 | 解决实际工程问题，有可复用的代码/工具，性能提升显著 |
| 5-6 | 值得了解 | 概念/教程/综述，对拓宽视野有帮助 |
| 1-4 | 可略过 | 重复内容、营销文、信息量低、与 AI 相关性弱 |

**约束：** 一次分析的条目中，打 9-10 分的数量不得超过总条目数的 15%（向上取整）。例如 15 项中最多 2 个 9-10 分。

### 3. 输出

```json
{
  "source": "tech_summary",
  "analyzed_at": "2026-05-28T12:00:00Z",
  "raw_file": "knowledge/raw/hacker-news-2026-05-28.json",
  "items_analyzed": 15,
  "results": [
    {
      "id": "github_trending_a3f2b1c8",
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
  ]
}
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| `knowledge/raw/` 为空或无 JSON 文件 | 返回 `{ results: [] }`，不抛异常 |
| 单条数据解析失败（缺字段） | 跳过该条，继续处理其余条目 |
| 文件内容不是合法 JSON | 返回空结果，日志 warn |
| 全部失败 | 返回 `{ results: [] }`，不输出 error stack |
| 所有输出必须为合法 JSON | 任何失败路径都必须返回合法 JSON 结构 |

## 自测

### 正常运行

```
Read: knowledge/raw/{latest} 含 ≥ 10 条
→ 每条输出 summary / highlights / score / tags
→ 9-10 分数量 ≤ 15% 限制
→ 输出合法 JSON
```

### 错误场景

| 测试 | 预期 |
|------|------|
| raw 目录为空 | 返回 `{ results: [] }` |
| 文件内容损坏 | 返回 `{ results: [] }` |
| 单条缺字段 | 跳过该条，其余正常输出 |
| 输出验证 | 最终输出始终是合法 JSON |

## 验收标准

- [ ] 成功读取最新采集文件
- [ ] 每条必填字段完整（summary / highlights / score / score_reason / tags）
- [ ] summary ≤ 50 字
- [ ] highlights 2-3 条，均有事实或数据支撑
- [ ] score 遵循评分标准，9-10 不超过 15%
- [ ] 输出为合法 JSON
