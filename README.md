# Supercharged Figma MCP

Supercharged Figma MCP 是一个可操作 Figma 桌面端的 MCP Server + Figma Plugin 组合。

它的目标是让 Agent 不只是“读设计”，还能真正执行设计操作：创建/编辑节点、组件化、原型交互、跨页面整理、样式与变量操作等。

## 文档

- 用户文档：`USER_GUIDE.md`
- 开发者文档：`DEVELOPER_GUIDE.md`

## 项目结构

- `src/`：MCP Server 源码（TypeScript）
- `figma-plugin/`：Figma 插件源码（`code.ts` + `ui-enhanced.html`）
- `dist/`：构建产物（MCP Server）
- `src/runtime/embedded-relay.ts`：内嵌 relay（默认随 MCP 启动）
- `relay-server.js`：外置 relay（兼容模式）
- `deploy/cloudflare/`：Cloudflare Worker 模板（`/supercharged-figma/ws` + `/mcp`）

## 快速开始（开发）

1. 安装依赖

```bash
npm install
```

2. 构建

```bash
npm run build
npm run plugin:build
```

3. 启动 MCP Server（stdio，默认内嵌 relay）

```bash
npm run start
```

可选参数（新模式）：

```bash
# 本地模式（默认）：内嵌 relay + MCP stdio
node dist/server.js --local

# 远端 relay 模式（MCP stdio）
node dist/server.js --remote wss://example.com/supercharged-figma/ws

# MCP 以 HTTP Streamable 暴露（可用于远端部署）
node dist/server.js --local --transport http --host 127.0.0.1 --port 3333 --mcp-path /mcp

# 自定义 relay ws 路径（本地/远端统一）
node dist/server.js --local --relay-host 127.0.0.1 --relay-port 8888 --relay-path /supercharged-figma/ws

# 兼容旧参数
node dist/server.js --relay-mode=local --relay-host=127.0.0.1 --relay-port=8888
node dist/server.js --relay-mode=remote --relay-url=ws://127.0.0.1:8888
```

`npx` 直接运行示例：

```bash
npx supercharged-figma-mcp --local
npx supercharged-figma-mcp --local --host 127.0.0.1 --port 3333
npx supercharged-figma-mcp --remote wss://example.com/supercharged-figma/ws --transport http --host 0.0.0.0 --port 3333
```

协议分层（重要）：

- MCP Client → MCP Server：`http/https`（Streamable HTTP）
- Figma Plugin ↔ Relay：`ws/wss`

Cloudflare Worker 说明：

- `deploy/cloudflare/worker-relay.ts` 同时提供 `/mcp` 和 `/supercharged-figma/ws`
- `/mcp` 支持多会话（`mcp-session-id`）与可选 API key 鉴权（`MCP_API_KEYS` secret）

4. 在 Figma 导入插件

- Figma Desktop → Plugins → Development → Import plugin from manifest
- 选择：`figma-plugin/manifest.json`

5. 连接 relay

- 默认不需要手动启动 relay（已内嵌）
- 在插件 `Config` 页输入 relay 地址并连接
- 复制 channel code 到 Agent 侧执行 `connect_to_relay`

## 常用脚本

```bash
npm run build            # 构建 MCP Server
npm run plugin:build     # 构建 Figma 插件 code.ts
npm run lint             # TypeScript 检查
npm run test             # 测试
npm run validate         # lint + build + test
```

## GitHub 自动发布 npm

仓库已提供 workflow：`.github/workflows/npm-publish.yml`

- 触发方式：
  - 手动触发 `workflow_dispatch`
  - 推送 tag（如 `v1.0.1`）
- 发布前会执行：`npm ci`、`npm run build`、`npm run test:integration`
- 需要在仓库 Secrets 配置：`NPM_TOKEN`

## 注意

- `figma-plugin/code.js` 是由 `figma-plugin/code.ts` 编译生成，请改 TS 不直接改 JS。
- 插件 UI 入口：`figma-plugin/ui-enhanced.html`。
