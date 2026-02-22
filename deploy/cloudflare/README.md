# Cloudflare Relay Deployment

这个目录提供 `Supercharged Figma` 的 Cloudflare Worker 模板（Relay + MCP）。

## 提供的能力

- `GET /healthz`
- `WS /supercharged-figma/ws?channel=<CHANNEL>&type=figma|client`
- `ALL /mcp`（MCP Streamable HTTP）

## 部署

1. 安装并登录 Wrangler

```bash
npm i -g wrangler
wrangler login
```

2. 在当前目录发布

```bash
cd deploy/cloudflare
# 可选：设置 MCP API 鉴权 key（逗号分隔多个）
wrangler secret put MCP_API_KEYS
wrangler deploy
```

3. 部署后地址示例

```txt
wss://<your-worker-domain>/supercharged-figma/ws
https://<your-worker-domain>/mcp
```

## 说明

- Worker 中 MCP 工具通过 Durable Object 桥接到 Figma 插件。
- 兼容旧工作流：Figma 插件使用 `type=figma` 且不带 channel 连接时，服务端会自动生成 channel 并在 `connected` 系统消息返回。
- MCP `/mcp` 已支持多会话：按 `mcp-session-id` 隔离 channel 绑定。
- 鉴权默认使用 Cloudflare Secret `MCP_API_KEYS`（无需额外数据库）：
  - 仅作用于 `/mcp`
  - `WS /supercharged-figma/ws` 不要求鉴权（便于插件连接）
  - 不设置该 secret：开放模式
  - 设置后：`Authorization: Bearer <API_KEY>` 必填

## API Key 后端存储建议

1. 默认（已实现）
- 存在 Cloudflare Secrets（`MCP_API_KEYS`）中
- 适合小中规模、固定 key、低复杂度

2. 进阶（可扩展）
- D1/KV 存储 key 元数据（租户、过期、限流、吊销）
- Worker 每次校验时查询（或做短期缓存）
- 适合多租户 SaaS 与运营审计
