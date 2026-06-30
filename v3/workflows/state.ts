/**
 * LangGraph 状态定义 — AI 知识库工作流的核心数据结构
 *
 * 所有节点共享同一个 KBState，通过 Annotation.Root 保证类型安全。
 * 每个节点只修改自己负责的字段，实现职责隔离。
 */

import { Annotation } from "@langchain/langgraph";

/**
 * 知识库工作流的全局状态
 *
 * 数据流向: sources → analyses → articles → review → save
 * review_loop 是本项目的核心教学点——展示如何用条件边实现质量门控。
 *
 * 遵循「报告式通信」原则：各字段承载结构化摘要，而非原始 HTML/API 响应全文。
 */
export const KBStateAnnotation = Annotation.Root({
  /**
   * 原始采集数据（报告式摘要，非原始 API 响应）
   * 格式：每条为 `{ source, title, url, description, stars, collected_at, ... }`
   */
  sources: Annotation<Record<string, unknown>[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  /**
   * LLM 分析后的结构化结果
   * 格式：每条含 `{ summary, tags, relevance_score, category, analyzed_at, ... }`
   */
  analyses: Annotation<Record<string, unknown>[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  /**
   * 格式化、去重后的知识条目
   * 格式：与 `knowledge/articles/*.json` 一致，含 `{ id, title, source, url, summary, tags, ... }`
   */
  articles: Annotation<Record<string, unknown>[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  /**
   * 审核 Agent 的反馈意见（中文）
   * 非空表示需 organize_node 根据建议定向修正条目
   */
  review_feedback: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  /** 审核是否通过，条件边的判断依据 */
  review_passed: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),

  /**
   * 当前审核循环次数（最多 3 次）
   * `iteration >= 2` 时 review_node 可强制通过，防止无限循环
   */
  iteration: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),

  /**
   * Planner 生成的采集策略
   * 格式：`{ tier, target_count, per_source_limit, relevance_threshold, max_iterations, rationale }`
   */
  plan: Annotation<Record<string, unknown>>({
    reducer: (_, update) => update,
    default: () => ({}),
  }),

  /**
   * Token 用量追踪（跨节点累加）
   * 格式：`{ prompt_tokens, completion_tokens, total_cost_yuan, call_count, ... }`
   */
  cost_tracker: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

/** KBState 类型，供 workflows/graph.ts 与 workflows/nodes.ts 引用 */
export type KBState = typeof KBStateAnnotation.State;
