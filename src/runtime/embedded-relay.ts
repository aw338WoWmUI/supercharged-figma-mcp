import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';

export interface EmbeddedRelayOptions {
  host: string;
  port: number;
  path?: string;
}

interface RelayChannel {
  figma: WebSocket | null;
  clients: Set<WebSocket>;
  createdAt: number;
}

export class EmbeddedRelay {
  private readonly options: EmbeddedRelayOptions;
  private readonly channels = new Map<string, RelayChannel>();
  private wss: WebSocketServer | null = null;

  constructor(options: EmbeddedRelayOptions) {
    this.options = options;
  }

  getWebSocketUrl(): string {
    const displayHost = this.options.host.includes(':') ? `[${this.options.host}]` : this.options.host;
    const path = this.normalizePath(this.options.path ?? '/');
    return `ws://${displayHost}:${this.options.port}${path}`;
  }

  async start(): Promise<void> {
    if (this.wss) return;

    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ host: this.options.host, port: this.options.port });
      this.wss = wss;

      const cleanupAndReject = (err: Error) => {
        try {
          wss.close();
        } catch {
          // ignore
        }
        this.wss = null;
        reject(err);
      };

      wss.on('listening', () => {
        console.log(chalk.green('✓ Embedded Relay started'));
        console.log(chalk.gray(`  Relay endpoint: ${this.getWebSocketUrl()}`));
        resolve();
      });

      wss.on('error', (err: any) => {
        const message = err?.code === 'EADDRINUSE'
          ? `Relay port ${this.options.port} is already in use`
          : `Embedded relay error: ${err?.message || String(err)}`;
        cleanupAndReject(new Error(message));
      });

      wss.on('connection', (ws, req) => {
        try {
          this.handleConnection(ws, req.url || '/');
        } catch (err: any) {
          try {
            ws.close(1011, err?.message || 'Relay connection setup failed');
          } catch {
            // ignore
          }
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;
    const wss = this.wss;
    this.wss = null;

    await new Promise<void>((resolve) => {
      for (const ws of wss.clients) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }
      wss.close(() => resolve());
    });
    this.channels.clear();
  }

  private generateChannelId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  private getOrCreateChannel(channelId: string): RelayChannel {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        figma: null,
        clients: new Set<WebSocket>(),
        createdAt: Date.now(),
      });
    }
    return this.channels.get(channelId)!;
  }

  private cleanupChannel(channelId: string) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    if (!channel.figma && channel.clients.size === 0) {
      this.channels.delete(channelId);
    }
  }

  private handleConnection(ws: WebSocket, rawUrl: string) {
    const baseHost = this.options.host.includes(':') ? `[${this.options.host}]` : this.options.host;
    const url = new URL(rawUrl, `http://${baseHost}:${this.options.port}`);
    const expectedPath = this.normalizePath(this.options.path ?? '/');
    if (url.pathname !== expectedPath) {
      ws.close(4004, `Invalid relay path. Expected: ${expectedPath}`);
      return;
    }

    let channelId = url.searchParams.get('channel');
    const clientType = url.searchParams.get('type') || 'unknown';

    if (clientType === 'figma' && !channelId) {
      channelId = this.generateChannelId();
    }
    if (!channelId) {
      ws.close(4000, 'Channel ID required');
      return;
    }

    const channel = this.getOrCreateChannel(channelId);

    if (clientType === 'figma') {
      if (channel.figma) {
        try {
          channel.figma.close();
        } catch {
          // ignore
        }
      }
      channel.figma = ws;

      ws.send(JSON.stringify({
        type: 'system',
        event: 'connected',
        channel: channelId,
      }));

      channel.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'system',
            event: 'figma_connected',
            channel: channelId,
          }));
        }
      });

      ws.on('message', (data) => {
        channel.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });
      });

      ws.on('close', () => {
        if (channel.figma !== ws) return;
        channel.figma = null;
        channel.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'system',
              event: 'figma_disconnected',
              channel: channelId,
            }));
          }
        });
        this.cleanupChannel(channelId!);
      });
    } else {
      channel.clients.add(ws);
      ws.send(JSON.stringify({
        type: 'system',
        event: 'connected',
        channel: channelId,
        figmaConnected: !!channel.figma,
      }));

      ws.on('message', (data) => {
        if (channel.figma && channel.figma.readyState === WebSocket.OPEN) {
          channel.figma.send(data);
        } else {
          ws.send(JSON.stringify({
            type: 'system',
            event: 'error',
            error: 'Figma not connected',
          }));
        }
      });

      ws.on('close', () => {
        channel.clients.delete(ws);
        this.cleanupChannel(channelId!);
      });
    }

    ws.on('error', () => {
      if (clientType === 'figma' && channel.figma === ws) {
        channel.figma = null;
      }
      if (clientType !== 'figma') {
        channel.clients.delete(ws);
      }
      this.cleanupChannel(channelId!);
    });
  }

  private normalizePath(rawPath: string): string {
    if (!rawPath || rawPath === '/') return '/';
    const withLeading = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
  }
}
