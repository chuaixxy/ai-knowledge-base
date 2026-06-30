/**
 * 采集节点 — 调用 GitHub Search API 获取 AI 相关仓库
 */

import type { KBState } from "./state.ts";

const GITHUB_SEARCH_URL =
  "https://api.github.com/search/repositories?q=topic:ai+topic:agent&sort=stars&per_page=10";

function nowUtcIso(): string {
  return new Date().toISOString();
}

export async function collectNode(
  state: KBState,
): Promise<Partial<KBState>> {
  console.log("[CollectNode] 开始采集 GitHub 仓库");

  const sources: Record<string, unknown>[] = [];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  const token = process.env.GITHUB_TOKEN ?? "";
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const resp = await fetch(GITHUB_SEARCH_URL, { headers });
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
