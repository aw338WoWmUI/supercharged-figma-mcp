# 开发者文档

本文档面向维护者，说明架构、构建与代码约定。

## 1. 架构概览

系统由三部分组成：

1. MCP Server（`src/server.ts`）
- 通过 stdio 对接 Agent
- 暴露工具描述与调用入口
- 通过 WebSocket relay 与 Figma 插件通信

2. Figma Plugin（`figma-plugin/code.ts` + `figma-plugin/ui-enhanced.html`）
- `code.ts`：在 Figma 运行时执行具体节点操作
- `ui-enhanced.html`：连接、状态、日志与用户交互

3. Relay Runtime
- 默认：内嵌 relay（`src/runtime/embedded-relay.ts`）随 MCP 进程启动
- 兼容：外置 relay（`relay-server.js`）
- 单实例守护：`src/runtime/instance-manager.ts`，避免重复占用同一 host/port
- 远端模板：`deploy/cloudflare/worker-relay.ts`（`/supercharged-figma/ws`）

## 2. 关键目录

- `src/server.ts`：MCP 工具定义、参数 schema、请求分发
- `src/runtime/embedded-relay.ts`：内嵌 relay runtime
- `src/runtime/instance-manager.ts`：relay 单实例锁
- `src/progress-manager.ts`：进度管理
- `src/enhanced-batch-operations.ts`：批量操作执行器
- `src/rest-bridge.ts`：REST 侧桥接能力
- `src/tests/`：单元与集成测试
- `figma-plugin/manifest.json`：插件清单（当前 UI: `ui-enhanced.html`）

## 3. 构建与运行

```bash
npm install
npm run build
npm run plugin:build
npm run test
```

启动模式：

```bash
# 默认：本地模式（local）+ stdio + 内嵌 relay
node dist/server.js --local

# 远端 relay 模式（不启动本地 relay）
node dist/server.js --remote wss://your-relay-host/supercharged-figma/ws

# MCP 以 HTTP Streamable 暴露（本地或部署场景）
node dist/server.js --local --transport http --host 0.0.0.0 --port 3333 --mcp-path /mcp

# relay 路径自定义（和远端保持一致）
node dist/server.js --local --relay-path /supercharged-figma/ws
```

- MCP Server 构建产物在 `dist/`
- 插件运行入口为 `figma-plugin/code.js`（由 `code.ts` 编译）

## 4. 开发约定

1. 插件逻辑修改原则
- 改 `figma-plugin/code.ts`，不要手改 `figma-plugin/code.js`
- UI 改 `figma-plugin/ui-enhanced.html`

2. 工具定义一致性
- `src/server.ts` 的工具描述必须与真实行为一致
- 新增/修改工具时，同时更新参数 schema 与插件执行端处理逻辑

3. 日志与错误处理
- MCP stdout 保持协议输出，运行日志走 stderr（已在 `server.ts` 处理）
- 错误消息保持结构化，便于 UI `Logs` 展示明细

4. UI 设计原则（插件小窗）
- 紧凑但可读
- `Config / Status / Logs` 分区清晰
- 顶部连接状态全局可见
- 日志支持展开详情

## 5. 发布前检查清单

1. `npm run lint`
2. `npm run build`
3. `npm run plugin:build`
4. `npm run test`
5. 在 Figma 真机验证：
- 连接/断开
- 复制 channel/prompt
- 常用工具调用（至少 create/modify/prototype 各一类）

## 6. 常见维护任务

## 新增工具

1. 在 `src/server.ts` 增加 tool schema
2. 在同文件调用分发中增加 case
3. 在 `figma-plugin/code.ts` 实现对应处理
4. 编译并实测

## 调整插件 UI

1. 在 `figma-plugin/ui-enhanced.html` 修改
2. 保持三 Tab 信息架构
3. 确认小窗口下无裁切、无大面积空白
