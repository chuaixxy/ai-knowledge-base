/**
 * 采集节点 — 调用 GitHub Search API 获取 AI 相关仓库
 */

import type { KBState } from "./state.ts";

const GITHUB_SEARCH_BASE =
  "https://api.github.com/search/repositories?q=topic:ai+topic:agent&sort=stars";

function nowUtcIso(): string {
  return new Date().toISOString();
}

export async function collectNode(
  state: KBState,
): Promise<Partial<KBState>> {
  const plan = state.plan ?? {};
  const limit = Number(plan.per_source_limit ?? 10);

  console.log(`[CollectNode] 开始采集 GitHub 仓库，plan 每源上限=${limit}`);

  const sources: Record<string, unknown>[] = [];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  const token = process.env.GITHUB_TOKEN ?? "";
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const url = `${GITHUB_SEARCH_BASE}&per_page=${limit}`;

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
          url: repo.html_url as string,
          description: (repo.description as string | null) ?? "",
          stars: (repo.stargazers_count as number) ?? 0,
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

  console.log(`[CollectNode] 采集到 ${sources.length} 条原始数据`);
  return { sources };
}
