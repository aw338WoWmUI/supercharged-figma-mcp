# Developer Guide / 开发者文档

## English
### Architecture
- MCP Server: `src/server.ts`
- Plugin runtime: `figma-plugin/code.ts`
- Plugin UI: `figma-plugin/ui-enhanced.html`
- Embedded relay: `src/runtime/embedded-relay.ts`
- Cloudflare deploy template: `deploy/cloudflare/`

### Build & Verify
```bash
npm install
npm run build
npm run plugin:build
npm run test
```

### Runtime Modes
```bash
# local: embedded relay + MCP stdio
node dist/server.js --local

# remote relay
node dist/server.js --remote wss://example.com/supercharged-figma/ws

# streamable MCP over HTTP
node dist/server.js --local --transport http --host 127.0.0.1 --port 3333 --mcp-path /mcp
```

### Conventions
- Edit TS source, not generated JS (`figma-plugin/code.js`).
- Keep tool schemas and actual behavior aligned.
- Keep UI compact for small plugin window.
- Keep user strings internationalized (`zh-CN` and `en`).

### Reference Alignment (Design With AI / TalkToFigma)
Based on these references:
- `grab/cursor-talk-to-figma-mcp` (tool strategy + relay workflow)
- `aranyak-4002/figma-design-mcp` (automation-oriented plugin patterns)

Recent alignment changes:
- `batch_create` now accepts create-type aliases across formats:
  - snake_case: `create_frame`
  - camelCase: `createFrame`
  - plain type: `frame`
  - kebab/uppercase variants are normalized too
- paint inputs are normalized consistently in creation and batch paths:
  - supports `#RRGGBB` / `#RGB`
  - supports full Figma paint objects
- `create_vector` accepts path aliases:
  - `vectorPaths`, `vectorPath`, `path`, `svgPath`, `d`
- `create_interaction` schema no longer advertises deprecated trigger keys that Figma rejects (e.g. `deprecatedVersion`).

Practical implication:
- Agent prompt-level parameter variance is tolerated better.
- Tool descriptions now better reflect actual runtime behavior.
- Fewer "schema says yes but plugin rejects" mismatches.

## 简体中文
### 架构
- MCP Server：`src/server.ts`
- 插件执行层：`figma-plugin/code.ts`
- 插件 UI：`figma-plugin/ui-enhanced.html`
- 内嵌 relay：`src/runtime/embedded-relay.ts`
- Cloudflare 部署模板：`deploy/cloudflare/`

### 构建与验证
```bash
npm install
npm run build
npm run plugin:build
npm run test
```

### 运行模式
```bash
# 本地模式：内嵌 relay + MCP stdio
node dist/server.js --local

# 远端 relay 模式
node dist/server.js --remote wss://example.com/supercharged-figma/ws

# Streamable HTTP MCP 模式
node dist/server.js --local --transport http --host 127.0.0.1 --port 3333 --mcp-path /mcp
```

### 约定
- 修改 TS 源码，不直接改生成文件（`figma-plugin/code.js`）。
- 工具 schema 与真实行为保持一致。
- 插件 UI 以小窗口可读性优先。
- 用户文案必须支持国际化（`zh-CN` / `en`）。

### 参考对齐（Design With AI / TalkToFigma）
参考仓库：
- `grab/cursor-talk-to-figma-mcp`（工具策略与 relay 工作流）
- `aranyak-4002/figma-design-mcp`（自动化插件模式）

本轮已落地：
- `batch_create` 支持多种创建类型别名写法：
  - snake：`create_frame`
  - camel：`createFrame`
  - plain：`frame`
  - kebab/大写也会归一化
- 创建与批量创建路径统一了 paint 输入归一化：
  - 支持 `#RRGGBB` / `#RGB`
  - 支持完整 Figma paint 对象
- `create_vector` 支持多种路径参数别名：
  - `vectorPaths`、`vectorPath`、`path`、`svgPath`、`d`
- `create_interaction` 的 schema 移除了会被 Figma 拒绝的过时 trigger 字段（例如 `deprecatedVersion`）。

效果：
- Agent 参数写法更宽容，工具调用更稳。
- 工具描述与真实行为更一致。
- 减少“schema 看起来可用但运行报错”的情况。
