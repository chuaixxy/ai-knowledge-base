# Coding Standards

本文档定义项目的代码规范，所有代码贡献必须遵循以下约定。

---

## 1. 命名规范

| 场景 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `github-api.ts`, `article-service.ts` |
| TypeScript 类型/类 | PascalCase | `interface KnowledgeArticle`, `class AppError` |
| 变量、导出函数 | camelCase | `const sourceUrl`, `export function fetchTrending()` |
| 模块内部函数 | camelCase | `function parseHtml()` |
| JSON 字段 | snake_case | `{ "source_url": "...", "collected_at": "..." }` |
| 数据库列名 | snake_case | `created_at`, `updated_at` |
| 环境变量 | SNAKE_CASE | `GITHUB_TOKEN`, `LOG_LEVEL` |

### 跨层命名转换

数据库 ↔ TypeScript ↔ API JSON 的字段名自动转换：

```typescript
// 数据库列名: snake_case
// TypeScript 类型: camelCase
interface KnowledgeArticle {
  sourceUrl: string;      // 对应数据库 source_url
  collectedAt: string;    // 对应数据库 collected_at
}

// API JSON 输出: snake_case（由序列化层自动转换）
// { "source_url": "...", "collected_at": "..." }
```

**禁止在业务代码中手动写 mapper 做字段名转换**，统一由序列化层（如 Zod）自动处理。

---

## 2. 文档规范

### JSDoc / TSDoc 风格

采用 Google 风格：

- `@param` 描述以名词短语开头，不加 "The"
- 说明参数含义，可包含默认值

**正确示例：**

```typescript
/**
 * 从 GitHub Trending 拉取指定语言的仓库列表。
 *
 * @param language - 编程语言筛选，默认 "python"。
 * @returns 仓库元数据列表。
 * @throws 当 API 限流时抛出 AppError。
 */
export async function fetchTrendingRepos(
  language: string = "python",
): Promise<TrendingRepo[]> {
  // ...
}
```

**错误示例：**

```typescript
/**
 * fetch trending repos
 * @param language This is the parameter for filtering language.
 * @returns returns the list
 */
```

### 规范要求

- 所有公共 API（export 的函数、类、接口）必须写 JSDoc
- 通过 PR Review 确保风格正确，不强制 ESLint 拦截
- 模块内部函数建议写注释说明用途，不做强制要求

---

## 3. 日志规范

### 使用统一的 Logger

```typescript
import { logger } from '@/lib/logger';

// 正确
logger.info({ language }, 'fetching trending repos');
logger.error({ err }, 'failed to fetch repos');

// 禁止
console.log('fetching trending repos');
console.error(err);
```

### ESLint 配置

```json
{
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }]
  }
}
```

- 普通 `console.log` 禁止提交
- 保留 `console.warn` / `console.error` 给紧急场景

### 调试日志

- 开发调试使用 `logger.debug()`，配合 `LOG_LEVEL=debug` 环境变量
- 调试代码进主分支前必须清理或调整日志级别
- 使用 `npm run lint:fix` 自动修复可修复的日志问题

---

## 4. 类型规范

### 类型定义要求

- 公共 API 与知识条目结构必须定义 TypeScript interface / type
- 明确区分**必填**和**可选**字段

```typescript
// 正确：可选字段用 ? 标记
interface KnowledgeArticle {
  id: string;                    // 必填
  title: string;                 // 必填
  author?: string;               // 可选
  publishedAt?: string;          // 可选
}
```

### 运行时校验

JSON 数据（如 `knowledge/articles/` 中的文件）必须使用 Zod 做运行时校验：

```typescript
import { z } from 'zod';

const KnowledgeArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  source_url: z.string(),        // JSON 中是 snake_case
  collected_at: z.string(),
}).transform((data) => ({
  ...data,
  sourceUrl: data.source_url,    // 转换为 camelCase
  collectedAt: data.collected_at,
}));

type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;
```

### 兼容性要求

- 新增字段必须是可选的（`?`），保证向后兼容
- 禁止修改已存在的必填字段的类型

---

## 5. 依赖管理

### 新增依赖流程

1. **PR 描述中必须说明：**
   - 依赖名称和版本
   - 用途说明（解决了什么问题）
   - 是否评估过更轻量的替代方案

2. **核心/高风险依赖**（如爬虫库、加密库、数据库驱动）额外写入 `DEPENDENCIES.md`，记录选型决策上下文

### 示例

```markdown
## PR 描述

### 新增依赖
- `puppeteer@^21.0.0`: 用于无头浏览器抓取动态渲染页面（cheerio 无法处理 JS 渲染内容）
- 已评估 `playwright` 作为替代，因项目仅需 Chromium 且 puppeteer 体积更小，故选择 puppeteer
```

---

## 6. 测试规范

### 测试文件组织

```
src/
  services/
    github-api.ts
    github-api.test.ts      # 与源码平行
  utils/
    formatter.ts
    formatter.test.ts

tests/
  integration/              # 集成测试
    collector.e2e.test.ts
  fixtures/                 # 测试数据
    github-trending.html
    hn-response.json
```

### 命名约定

- 单元测试：`*.test.ts`
- 集成测试：`tests/integration/*.e2e.test.ts`
- 测试数据：`tests/fixtures/*`

### Mock 策略

- 外部 HTTP 请求（GitHub API、Hacker News）统一使用 **MSW** 拦截
- 禁止测试直接调用真实外部服务

```typescript
import { rest } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  rest.get('https://api.github.com/repos/*', (req, res, ctx) => {
    return res(ctx.json({ id: 123, name: 'test-repo' }));
  }),
);
```

---

## 7. 错误处理

### 统一错误类

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### 使用规范

- 业务错误使用 `AppError`，包含错误码和可读消息
- 意外错误记录后返回 500，禁止暴露原始错误消息给外部

```typescript
// 正确
try {
  const data = await fetchGitHubApi();
} catch (err) {
  logger.error({ err, url }, 'GitHub API request failed');
  throw new AppError('GITHUB_API_ERROR', '无法获取 GitHub 数据', err);
}

// API 返回格式
// { "success": false, "error": { "code": "GITHUB_API_ERROR", "message": "无法获取 GitHub 数据" } }
```

### API 错误响应格式

```typescript
interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
```

---

## 8. 调试代码红线

以下代码**绝对禁止**遗留到主分支：

| 禁止项 | 示例 |
|--------|------|
| `console.log` | `console.log('debug:', data)` |
| 注释掉的测试用例 | `// it('should work', () => {` |
| 临时的 TODO | `// TODO: fix this` |
| 性能测试代码 | `console.time('fetch'); ... console.timeEnd('fetch')` |
| 临时断点 | `debugger;` |

### 允许的例外

- `console.warn` / `console.error`：用于紧急场景
- 带 Issue 编号的 TODO：`// TODO(#123): 添加缓存层，等待 Redis 部署完成`
  - 格式：`TODO(#Issue编号): 说明`
  - PR 描述中需说明关联的 Issue

---

## 9. 代码格式

代码格式遵循项目根目录 `.prettierrc` 配置，提交前自动格式化。

### 工具配置

1. **ESLint + Prettier 集成**
2. **lint-staged**：pre-commit 时自动修复可修复的问题
3. **npm 脚本**：
   ```json
   {
     "scripts": {
       "lint": "eslint . --ext .ts,.tsx",
       "lint:fix": "eslint . --ext .ts,.tsx --fix"
     }
   }
   ```

### CI 检查

- 所有 PR 必须通过 `pnpm lint` 检查
- 未通过的 PR 禁止合并

---

## 相关配置速查

| 配置项 | 文件位置 |
|--------|----------|
| ESLint 配置 | `.eslintrc.json` |
| Prettier 配置 | `.prettierrc` |
| lint-staged | `package.json` 或 `.lintstagedrc.json` |
| 依赖文档 | `DEPENDENCIES.md`（核心依赖） |

---

*本规范随项目演进更新，如有疑问请在 Issue 中讨论。*
