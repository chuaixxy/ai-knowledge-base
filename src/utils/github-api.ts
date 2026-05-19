/**
 * GitHub API 工具函数
 *
 * 提供从 GitHub API 获取仓库基本信息的能力。
 */

import type { Context } from "hono";

/**
 * GitHub 仓库基本信息结构
 */
export interface RepoInfo {
  /** 仓库全名，格式：owner/repo */
  full_name: string;
  /** 仓库描述 */
  description: string | null;
  /** Star 数 */
  stargazers_count: number;
  /** Fork 数 */
  forks_count: number;
  /** 主要编程语言 */
  language: string | null;
  /** 仓库主页 URL */
  html_url: string;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

/**
 * 从 GitHub API 获取指定仓库的基本信息。
 *
 * @param owner - 仓库所有者（用户名或组织名）。
 * @param repo - 仓库名称。
 * @returns 仓库基本信息，包括 Star 数、Fork 数、描述等。
 * @throws 当请求失败或仓库不存在时抛出错误。
 *
 * @example
 * ```typescript
 * const info = await fetchRepoInfo("honojs", "hono");
 * console.log(info.stargazers_count); // Star 数
 * ```
 */
export async function fetchRepoInfo(
  owner: string,
  repo: string,
): Promise<RepoInfo> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      // 如果有 GitHub Token，可以从环境变量读取
      // Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  return {
    full_name: data.full_name,
    description: data.description,
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    language: data.language,
    html_url: data.html_url,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/**
 * Hono 路由处理器：获取仓库信息
 *
 * 用法：GET /api/repo/:owner/:repo
 *
 * @param c - Hono Context
 * @returns JSON 格式的仓库信息
 */
export async function getRepoHandler(c: Context): Promise<Response> {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");

  if (!owner || !repo) {
    return c.json(
      { error: "Missing required parameters: owner and repo" },
      400,
    );
  }

  try {
    const info = await fetchRepoInfo(owner, repo);
    return c.json(info);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return c.json({ error: message }, status);
  }
}
