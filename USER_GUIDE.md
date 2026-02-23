# User Guide / 用户文档

## English
### Connection Flow
1. Start MCP server (`--local` starts embedded relay by default).
2. Open Figma plugin `Supercharged Figma AI`.
3. In `Config`, enter relay URL and click **Connect**.
4. Copy channel code / connect prompt.
5. Run `connect_to_relay` in your MCP client.

### UI Tabs
- `Config`: relay URL, connection, MCP config snippets, copy actions
- `Status`: progress, tool count, active operations
- `Logs`: expandable operation logs

### MCP Config in UI
- `mcp.json snippet`: auto-switches by Relay URL.
- Local relay URL (`127.0.0.1`/`localhost`) => `--local --relay-host --relay-port`.
- Remote relay URL (`wss://...`) => `--remote <relay-url>`.
- `Hosted HTTP MCP config`: for deployed streamable HTTP endpoint (`https://.../mcp`).

### Language
- Plugin auto-detects language (zh -> 简体中文, others -> English).
- You can always switch language from the top-right selector.

### Troubleshooting
- Copy issues: plugin has clipboard fallback; retry and check `Logs`.
- `local-network-access` warnings in Figma console are usually platform-level and often non-blocking.

## 简体中文
### 连接流程
1. 启动 MCP Server（`--local` 默认内嵌 relay）。
2. 打开 Figma 插件 `Supercharged Figma AI`。
3. 在 `Config` 输入 relay 地址并点击连接。
4. 复制 Channel Code / connect prompt。
5. 在 MCP 客户端执行 `connect_to_relay`。

### 三个 Tab
- `Config`：relay 配置、连接按钮、MCP 配置片段、复制操作
- `Status`：进度、工具数量、活动操作
- `Logs`：可展开活动日志

### UI 中的 MCP 配置
- `mcp.json 片段` 会根据 Relay URL 自动切换模式。
- 本地 Relay（`127.0.0.1`/`localhost`）=> `--local --relay-host --relay-port`。
- 远端 Relay（`wss://...`）=> `--remote <relay-url>`。
- `已部署 HTTP MCP 配置` 用于云端 streamable HTTP 地址（`https://.../mcp`）。

### 多语言
- 默认自动识别语言（`zh` -> 简体中文，其它 -> English）。
- 右上角可随时手动切换语言。

### 常见问题
- 复制失败：插件已内置 fallback 复制，重试并查看 `Logs`。
- 控制台出现 `local-network-access` 类警告：多为 Figma 容器策略提示，通常不影响功能。
