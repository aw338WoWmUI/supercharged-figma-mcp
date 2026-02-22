import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  MCP_API_KEYS?: string;
}

const RELAY_PATH = '/supercharged-figma/ws';
const MCP_PATH = '/mcp';

interface SessionContext {
  createdAt: number;
  lastSeenAt: number;
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  channelCode: string | null;
  relayUrl: string | null;
}

const SESSION_TTL_MS = 1000 * 60 * 60; // 1h
const sessions = new Map<string, SessionContext>();

function generateChannelCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

const BASE_TOOLS: Tool[] = [
  {
    name: 'connect_to_relay',
    description: 'Connect to Figma via Relay Server. Prerequisite: user must open the Figma plugin first and provide a real Channel Code. NEVER guess/fabricate channelCode. If missing, ask user to provide: connect_to_relay {"relayUrl":"ws://127.0.0.1:8888","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}. Use wss:// for remote production relay endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        channelCode: { type: 'string' },
        relayUrl: { type: 'string' },
      },
      required: ['channelCode'],
    },
  },
  {
    name: 'get_connection_status',
    description: 'Check MCP<->Figma connection state before any design tool call. Use this first. If disconnected, ask user to open Figma plugin and provide channel code, then call connect_to_relay.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function bridgeCall(
  env: Env,
  channel: string,
  message: unknown,
  timeoutMs = 120000
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const roomId = env.RELAY_ROOM.idFromName(channel);
  const stub = env.RELAY_ROOM.get(roomId);
  const resp = await stub.fetch(`https://relay.internal/bridge?channel=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      timeoutMs,
    }),
  });

  const payload = await resp.json<any>().catch(() => ({ ok: false, error: `Bridge HTTP ${resp.status}` }));
  if (!resp.ok) {
    return { ok: false, error: payload?.error || `Bridge HTTP ${resp.status}` };
  }
  return payload;
}

async function relayStatus(env: Env, channel: string): Promise<{ figmaConnected: boolean }> {
  const roomId = env.RELAY_ROOM.idFromName(channel);
  const stub = env.RELAY_ROOM.get(roomId);
  const resp = await stub.fetch(`https://relay.internal/status?channel=${encodeURIComponent(channel)}`);
  if (!resp.ok) return { figmaConnected: false };
  const payload = await resp.json<any>().catch(() => ({ figmaConnected: false }));
  return { figmaConnected: !!payload?.figmaConnected };
}

function parseApiKeys(env: Env): string[] {
  const raw = env.MCP_API_KEYS?.trim();
  if (!raw) return [];
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function isAuthorized(request: Request, env: Env): boolean {
  const keys = parseApiKeys(env);
  if (keys.length === 0) return true; // open mode

  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1].trim();
  return keys.includes(token);
}

async function buildTools(env: Env, channelCode: string | null): Promise<Tool[]> {
  if (!channelCode) return BASE_TOOLS;

  const bridgeResp = await bridgeCall(env, channelCode, {
    type: 'get_tools',
    id: crypto.randomUUID(),
    payload: {},
  }, 15000);

  if (!bridgeResp.ok) return BASE_TOOLS;
  const tools = (bridgeResp.result as any)?.tools;
  if (!Array.isArray(tools)) return BASE_TOOLS;

  // De-duplicate potential overlap with base tools
  const existing = new Set(BASE_TOOLS.map((t) => t.name));
  const normalized = tools.filter((t: any) => t && typeof t.name === 'string' && !existing.has(t.name));
  return [...BASE_TOOLS, ...normalized];
}

async function createMcpServer(env: Env, session: SessionContext): Promise<Server> {
  const server = new Server(
    { name: 'supercharged-figma-worker-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: await buildTools(env, session.channelCode) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'connect_to_relay') {
      const channelCode = (args as any)?.channelCode;
      const relayUrlArg = (args as any)?.relayUrl;
      const targetRelayUrl = typeof relayUrlArg === 'string' && relayUrlArg.trim()
        ? relayUrlArg.trim()
        : (session.relayUrl || 'ws://127.0.0.1:8888');
      if (!channelCode || typeof channelCode !== 'string') {
        return {
          content: [{
            type: 'text',
            text: '❌ 需要提供 Channel Code（禁止猜测）\n\n请先在 Figma 插件中获取真实 Channel Code，然后调用：\nconnect_to_relay {"relayUrl":"ws://127.0.0.1:8888","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}',
          }],
        };
      }
      session.channelCode = channelCode.trim();
      session.relayUrl = targetRelayUrl;
      const status = await relayStatus(env, session.channelCode);
      return {
        content: [{
          type: 'text',
          text: status.figmaConnected
            ? `✅ 成功连接到 Figma！\nRelay: ${targetRelayUrl}\nChannel: ${session.channelCode}\n现在可以使用所有 Figma 工具了。`
            : `✅ 已绑定 Channel，等待 Figma 插件连接...\nRelay: ${targetRelayUrl}\nChannel: ${session.channelCode}\n请在 Figma 插件中连接 Relay Server。`,
        }],
      };
    }

    if (name === 'get_connection_status') {
      if (!session.channelCode) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ready: false,
            connectedToRelay: false,
            figmaHandshakeComplete: false,
            relayUrl: session.relayUrl || 'ws://127.0.0.1:8888',
            channelCode: null,
            figmaConnected: false,
            nextAction: 'Not connected. Ask user to open Figma plugin, get Channel Code, then run connect_to_relay.',
            connectTemplate: `connect_to_relay {"relayUrl":"${session.relayUrl || 'ws://127.0.0.1:8888'}","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}`,
          }, null, 2) }],
        };
      }
      const status = await relayStatus(env, session.channelCode);
      const relayUrl = session.relayUrl || 'ws://127.0.0.1:8888';
      return {
        content: [{ type: 'text', text: JSON.stringify({
          ready: status.figmaConnected,
          connectedToRelay: true,
          figmaHandshakeComplete: status.figmaConnected,
          relayUrl,
          channelCode: session.channelCode,
          figmaConnected: status.figmaConnected,
          nextAction: status.figmaConnected
            ? 'Connected. You can run other MCP tools now.'
            : 'Not connected. Ask user to open Figma plugin, get Channel Code, then run connect_to_relay.',
          connectTemplate: `connect_to_relay {"relayUrl":"${relayUrl}","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}`,
        }, null, 2) }],
      };
    }

    if (!session.channelCode) {
      return {
        content: [{ type: 'text', text: 'Not bound to channel. Call connect_to_relay first.' }],
        isError: true,
      };
    }

    const bridgeResp = await bridgeCall(env, session.channelCode, {
      type: name,
      id: crypto.randomUUID(),
      payload: args,
    });

    if (!bridgeResp.ok) {
      return {
        content: [{ type: 'text', text: bridgeResp.error || 'Bridge call failed' }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(bridgeResp.result ?? {}, null, 2) }],
    };
  });

  return server;
}

function gcSessions() {
  const now = Date.now();
  for (const [sessionId, ctx] of sessions.entries()) {
    if (now - ctx.lastSeenAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      void ctx.server.close().catch(() => {});
    }
  }
}

async function createSession(env: Env): Promise<SessionContext> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const session: SessionContext = {
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    transport,
    server: null as unknown as Server,
    channelCode: null,
    relayUrl: null,
  };
  session.server = await createMcpServer(env, session);
  await session.server.connect(transport);
  return session;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    gcSessions();

    if (url.pathname === '/healthz') {
      return json({
        ok: true,
        service: 'supercharged-figma-worker',
        relayPath: RELAY_PATH,
        mcpPath: MCP_PATH,
        activeSessions: sessions.size,
        authEnabled: parseApiKeys(env).length > 0,
      });
    }

    if (url.pathname === MCP_PATH) {
      if (!isAuthorized(request, env)) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
      }

      const method = request.method.toUpperCase();
      const incomingSessionId = request.headers.get('mcp-session-id');
      let session: SessionContext | undefined;

      if (incomingSessionId) {
        session = sessions.get(incomingSessionId);
        if (!session) {
          return json({ ok: false, error: 'Unknown or expired MCP session' }, 404);
        }
      } else {
        session = await createSession(env);
      }

      session.lastSeenAt = Date.now();
      const response = await session.transport.handleRequest(request);
      const returnedSessionId = response.headers.get('mcp-session-id');
      if (returnedSessionId && !sessions.has(returnedSessionId)) {
        sessions.set(returnedSessionId, session);
      }

      if (method === 'DELETE') {
        const sid = incomingSessionId || returnedSessionId;
        if (sid) {
          const old = sessions.get(sid);
          if (old) {
            sessions.delete(sid);
            void old.server.close().catch(() => {});
          }
        }
      }
      return response;
    }

    if (url.pathname !== RELAY_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    const clientType = url.searchParams.get('type') || 'unknown';
    let channel = url.searchParams.get('channel');

    // Keep legacy flow: plugin can connect without channel and get one assigned by server.
    if (!channel && clientType === 'figma') {
      channel = generateChannelCode();
      url.searchParams.set('channel', channel);
    }

    if (!channel) {
      return new Response('channel is required (or connect as type=figma to auto-generate)', { status: 400 });
    }

    const roomId = env.RELAY_ROOM.idFromName(channel);
    const stub = env.RELAY_ROOM.get(roomId);
    return stub.fetch(new Request(url.toString(), request));
  },
};

export class RelayRoomDO {
  private figma: WebSocket | null = null;
  private clients = new Set<WebSocket>();
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: number;
  }>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/status') || url.pathname === '/status') {
      return json({ figmaConnected: !!this.figma });
    }

    if (url.pathname.endsWith('/bridge') || url.pathname === '/bridge') {
      return this.handleBridgeRequest(request);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    const clientType = url.searchParams.get('type') || 'unknown';
    const channel = url.searchParams.get('channel') || 'UNKNOWN';
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    serverSocket.accept();
    this.attachSocket(serverSocket, clientType, channel);
    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  private async handleBridgeRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    const body = await request.json<any>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    const message = body.message;
    const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : 120000;

    if (!this.figma) {
      return json({ ok: false, error: 'Figma not connected' }, 409);
    }
    if (!message || typeof message !== 'object') {
      return json({ ok: false, error: 'message is required' }, 400);
    }

    const messageId = (message as any).id;
    try {
      this.figma.send(JSON.stringify(message));
    } catch {
      return json({ ok: false, error: 'Failed to send to Figma' }, 500);
    }

    if (!messageId || typeof messageId !== 'string') {
      return json({ ok: true, result: { sent: true } });
    }

    return new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(messageId);
        resolve(json({ ok: false, error: `Timeout waiting response for ${messageId}` }, 504));
      }, timeoutMs);

      this.pending.set(messageId, {
        resolve: (value) => {
          clearTimeout(timeout);
          this.pending.delete(messageId);
          resolve(json({ ok: true, result: value }));
        },
        reject: (reason) => {
          clearTimeout(timeout);
          this.pending.delete(messageId);
          resolve(json({ ok: false, error: reason.message }, 500));
        },
        timeout: timeout as unknown as number,
      });
    });
  }

  private attachSocket(ws: WebSocket, clientType: string, channel: string) {
    if (clientType === 'figma') {
      if (this.figma) {
        try {
          this.figma.close(1000, 'Figma reconnected');
        } catch {
          // ignore
        }
      }
      this.figma = ws;
      this.sendJson(ws, { type: 'system', event: 'connected', channel });
      this.broadcastClients({ type: 'system', event: 'figma_connected', channel });

      ws.addEventListener('message', (event: MessageEvent) => {
        const maybeText = typeof event.data === 'string' ? event.data : '';
        let parsed: any = null;
        try {
          parsed = maybeText ? JSON.parse(maybeText) : null;
        } catch {
          parsed = null;
        }

        if (parsed && typeof parsed.id === 'string') {
          const pending = this.pending.get(parsed.id);
          if (pending) {
            if (parsed.error) {
              pending.reject(new Error(String(parsed.error)));
            } else {
              pending.resolve(parsed.result ?? parsed);
            }
          }
        }

        for (const client of this.clients) {
          try {
            client.send(event.data);
          } catch {
            // ignore
          }
        }
      });

      ws.addEventListener('close', () => {
        if (this.figma === ws) {
          this.figma = null;
          this.broadcastClients({ type: 'system', event: 'figma_disconnected', channel });
          for (const [id, pending] of this.pending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Figma disconnected while waiting for ${id}`));
          }
          this.pending.clear();
        }
      });
      return;
    }

    this.clients.add(ws);
    this.sendJson(ws, { type: 'system', event: 'connected', channel, figmaConnected: !!this.figma });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (this.figma) {
        try {
          this.figma.send(event.data);
        } catch {
          this.sendJson(ws, { type: 'system', event: 'error', error: 'Figma not connected' });
        }
      } else {
        this.sendJson(ws, { type: 'system', event: 'error', error: 'Figma not connected' });
      }
    });

    ws.addEventListener('close', () => {
      this.clients.delete(ws);
    });
  }

  private broadcastClients(payload: unknown) {
    const raw = JSON.stringify(payload);
    for (const client of this.clients) {
      try {
        client.send(raw);
      } catch {
        // ignore
      }
    }
  }

  private sendJson(ws: WebSocket, payload: unknown) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
}
