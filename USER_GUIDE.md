# 用户文档

本文档面向最终使用者，介绍如何连接与使用 Supercharged Figma MCP。

## 1. 你将获得什么

- 在 Figma 中由 Agent 执行真实操作（而非仅文字建议）
- 可见的连接状态、运行状态和活动日志
- 通过 `Config / Status / Logs` 三个 Tab 管理工作流

## 2. 基本连接流程

前提：
- 启动 MCP Server（默认会自动启动内嵌 relay：`ws://127.0.0.1:8888`）

1. 打开 Figma 插件 `Supercharged Figma AI`
2. 进入 `Config` Tab
3. 填写 Relay URL（默认 `ws://127.0.0.1:8888`）
4. 点击连接
5. 复制 Channel Code
6. 在 Agent 中执行 `connect_to_relay`（带 relayUrl + channelCode）

连接成功后：
- 顶部状态显示 `已连接`
- `Status` 中可看到运行统计
- `Logs` 中可查看操作日志

协议说明：
- MCP Client（Cursor/Claude）连接 MCP Server：`http/https`（Streamable HTTP）或本地 `stdio`
- Figma 插件连接 relay：`ws/wss`

## 3. 界面说明

## Config

- Relay 地址配置
- Connect / Disconnect
- 一键复制 `connect_to_relay` prompt
- Channel Code 展示与复制

## Status

- 进度条与阶段信息
- `可用工具`：优先来自服务端 `get_tools`
- `运行中操作`：当前未完成操作数
- 操作分组列表（可展开/收起）

## Logs

- 活动日志（支持展开详情）
- 展开全部 / 收起全部 / 清除

## 4. 常见问题

## 复制按钮点击后没复制到预期内容

通常是旧插件代码或 iframe 权限导致。当前版本已做 fallback 复制策略。

建议：
1. 重新构建并重载插件
2. 再次点击复制按钮
3. 在 `Logs` 中确认是否有复制成功提示

## 控制台出现 `local-network-access` / permissions policy 警告

这是 Figma 容器策略提示，常见且通常不影响业务功能。

## 5. 使用建议

- 先在 `Config` 完成连接，再进入 `Status/Logs` 观察执行
- 遇到异常优先看 `Logs` 最后一条带 detail 的报错
- 大规模整理前建议先让 Agent 做一轮“预演”（只读分析 + 操作计划）
