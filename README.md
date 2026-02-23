# Supercharged Figma MCP

## English
Supercharged Figma MCP is an MCP Server + Figma Plugin stack that lets agents perform real Figma operations (not read-only).

- User guide: `USER_GUIDE.md`
- Developer guide: `DEVELOPER_GUIDE.md`

### Quick Start
```bash
npm install
npm run build
npm run plugin:build
npm run start
```

### Runtime Modes
```bash
# local mode (embedded relay + MCP stdio)
node dist/server.js --local

# remote relay mode
node dist/server.js --remote wss://example.com/supercharged-figma/ws

# expose MCP as streamable HTTP
node dist/server.js --local --transport http --host 127.0.0.1 --port 3333 --mcp-path /mcp
```

### npx
```bash
npx -y supercharged-figma-mcp --local
```

### MCP Config Examples
```json
{
  "mcpServers": {
    "supercharged-figma": {
      "command": "npx",
      "args": [
        "-y",
        "supercharged-figma-mcp",
        "--local",
        "--relay-host",
        "127.0.0.1",
        "--relay-port",
        "8888"
      ]
    }
  }
}
```

```json
{
  "mcpServers": {
    "supercharged-figma-http": {
      "url": "https://your-domain.example.com/mcp"
    }
  }
}
```

### Protocol Split
- MCP Client -> MCP Server: `stdio` or `http/https` (Streamable HTTP)
- Figma Plugin <-> Relay: `ws/wss`

### Project Layout
- `src/`: MCP server (TypeScript)
- `figma-plugin/`: plugin runtime (`code.ts`) and UI (`ui-enhanced.html`)
- `deploy/cloudflare/`: Worker deployment template for `/mcp` and `/supercharged-figma/ws`

### Release
GitHub release is driven by `.github/workflows/npm-publish.yml`:
- Publish trigger: push tags matching `v*` (for example `v1.0.4`)
- Manual trigger: `workflow_dispatch`
- CI will run build/test checks before `npm publish`

## 简体中文
Supercharged Figma MCP 是一个 MCP Server + Figma 插件组合，支持 Agent 对 Figma 进行真实可执行操作。

- 用户文档：`USER_GUIDE.md`
- 开发者文档：`DEVELOPER_GUIDE.md`

### 快速开始
```bash
npm install
npm run build
npm run plugin:build
npm run start
```

### 运行模式
```bash
# 本地模式（内嵌 relay + MCP stdio）
node dist/server.js --local

# 远端 relay 模式
node dist/server.js --remote wss://example.com/supercharged-figma/ws

# MCP 以 Streamable HTTP 暴露
node dist/server.js --local --transport http --host 127.0.0.1 --port 3333 --mcp-path /mcp
```

### npx
```bash
npx -y supercharged-figma-mcp --local
```

### MCP 配置示例
```json
{
  "mcpServers": {
    "supercharged-figma": {
      "command": "npx",
      "args": [
        "-y",
        "supercharged-figma-mcp",
        "--local",
        "--relay-host",
        "127.0.0.1",
        "--relay-port",
        "8888"
      ]
    }
  }
}
```

```json
{
  "mcpServers": {
    "supercharged-figma-http": {
      "url": "https://your-domain.example.com/mcp"
    }
  }
}
```

### 协议分层
- MCP Client -> MCP Server：`stdio` 或 `http/https`（Streamable HTTP）
- Figma 插件 <-> Relay：`ws/wss`

### 发布
GitHub 自动发布由 `.github/workflows/npm-publish.yml` 处理：
- 触发方式：推送形如 `v*` 的 tag（例如 `v1.0.4`）
- 手动触发：`workflow_dispatch`
- 发布流程：CI 先执行构建与测试，再执行 `npm publish`
