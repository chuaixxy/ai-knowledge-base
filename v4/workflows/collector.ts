/**
 * 采集节点 — 从 GitHub Search API 与 RSS 源采集 AI 相关内容
 *
 * GitHub 搜索策略与 v4-production/workflows/collector.py 对齐：
 * 只采最近 7 天 push 过、star > 100 的 AI/Agent/LLM 仓库。
 *
 * RSS 源列表读取 pipeline/rss_sources.yaml，逻辑与 v3 pipeline 对齐。
 */

import { sanitizeInput } from "../tests/security.ts";
import { collectRss } from "./rss-collector.ts";
import type { KBState } from "./state.ts";

function nowUtcIso(): string {
  return new Date().toISOString();
}

function oneWeekAgoUtc(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

function buildGitHubSearchUrl(limit: number): string {
  const query = `ai agent llm stars:>100 pushed:>${oneWeekAgoUtc()}`;
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`;
}

async function collectGitHub(
  limit: number,
): Promise<Record<string, unknown>[]> {
  const sources: Record<string, unknown>[] = [];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  const token = process.env.GITHUB_TOKEN ?? "";
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const url = buildGitHubSearchUrl(limit);
  console.log(
    `[CollectNode] GitHub 搜索: ai agent llm stars:>100 pushed:>${oneWeekAgoUtc()}`,
  );

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as {
      items?: Array<Record<string, unknown>>;
    };

    if (!data.items?.length) {
      sources.push({
        source: "github",
        title: "[ERROR]",
        description: "GitHub API 返回空结果",
      });
    } else {
      for (const repo of data.items) {
        sources.push({
          source: "github",
          title: repo.full_name as string,
          source_id: repo.full_name as string,
          url: repo.html_url as string,
          description: (repo.description as string | null) ?? "",
          stars: (repo.stargazers_count as number) ?? 0,
          language: (repo.language as string | null) ?? "",
          collected_at: nowUtcIso(),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sources.push({
      source: "github",
      title: "[ERROR]",
      description: message,
    });
  }

  console.log(`[CollectNode] GitHub 采集完成，共 ${sources.length} 条`);
  return sources;
}

function sanitizeSources(sources: Record<string, unknown>[]): void {
  let totalWarnings = 0;

  for (const source of sources) {
    for (const field of ["title", "description"] as const) {
      const value = source[field];
      if (typeof value !== "string") continue;

      const [cleaned, warnings] = sanitizeInput(value);
      source[field] = cleaned;
      totalWarnings += warnings.length;

      if (warnings.length > 0) {
        console.log(
          `[Security] ${String(source.url ?? "?")} ${field} 检出注入模式：${warnings.join(", ")}`,
        );
      }
    }
  }

  if (totalWarnings > 0) {
    console.log(`[Security] collect 阶段共拦截 ${totalWarnings} 处可疑输入`);
  }
}

export async function collectNode(
  state: KBState,
): Promise<Partial<KBState>> {
  const plan = state.plan ?? {};
  const limit = Number(plan.per_source_limit ?? 10);

  console.log(
    `[CollectNode] 开始采集，plan 每源上限=${limit}（GitHub + RSS）`,
  );

  const [githubSources, rssSources] = await Promise.all([
    collectGitHub(limit),
    collectRss(limit),
  ]);

  const sources = [...githubSources, ...rssSources];
  sanitizeSources(sources);

  console.log(
    `[CollectNode] 采集到 ${sources.length} 条原始数据（GitHub ${githubSources.length} + RSS ${rssSources.length}）`,
  );
  return { sources };
}
