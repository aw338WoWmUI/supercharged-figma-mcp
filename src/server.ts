#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import {
  PluginMessage,
  PluginResponse,
} from './types.js';
import { ProgressManager } from './progress-manager.js';
import { EnhancedBatchExecutor } from './enhanced-batch-operations.js';
import { FigmaRESTBridge, CrossProjectSync } from './rest-bridge.js';
import { EmbeddedRelay } from './runtime/embedded-relay.js';
import { InstanceManager } from './runtime/instance-manager.js';
import { format } from 'node:util';
import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// MCP over stdio requires stdout to be protocol-only JSON-RPC.
// Route operational logs to stderr to avoid breaking the transport.
const logToStderr = (...args: unknown[]) => {
  process.stderr.write(`${format(...args)}\n`);
};
console.log = logToStderr;
console.info = logToStderr;
console.warn = logToStderr;
const require = createRequire(import.meta.url);
const MCP_SERVER_VERSION = (() => {
  try {
    return require('../package.json')?.version || 'dev';
  } catch {
    return 'dev';
  }
})();
const RELAY_PING_INTERVAL_MS = 20_000;
const RELAY_PONG_TIMEOUT_MS = 45_000;

// WebSocket connection to Figma Plugin via Relay Server
class FigmaPluginConnection {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private connected = false;
  private figmaConnected = false;
  private channelId: string | null = null;
  private connectSeq = 0;
  private readonly debugEvents: Array<{ ts: string; event: string; detail?: string }> = [];
  private relayPingTimer: NodeJS.Timeout | null = null;
  private relayPongDeadlineTimer: NodeJS.Timeout | null = null;

  private pushDebug(event: string, detail?: string) {
    this.debugEvents.push({ ts: new Date().toISOString(), event, detail });
    if (this.debugEvents.length > 80) {
      this.debugEvents.splice(0, this.debugEvents.length - 80);
    }
  }

  private parseIncomingMessage(data: WebSocket.Data): any | null {
    try {
      if (typeof data === 'string') return JSON.parse(data);
      if (data instanceof Buffer) return JSON.parse(data.toString('utf8'));
      if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8'));
      if (Array.isArray(data)) return JSON.parse(Buffer.concat(data).toString('utf8'));
      return JSON.parse(String(data));
    } catch (err) {
      console.error(chalk.red('Failed to parse message:'), err);
      return null;
    }
  }

  private rejectAllPending(reason: Error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
      pending.reject(reason);
    }
  }

  private clearRelayKeepaliveTimers() {
    if (this.relayPingTimer) {
      clearInterval(this.relayPingTimer);
      this.relayPingTimer = null;
    }
    if (this.relayPongDeadlineTimer) {
      clearTimeout(this.relayPongDeadlineTimer);
      this.relayPongDeadlineTimer = null;
    }
  }

  private refreshRelayPongDeadline(socket: WebSocket, connectId: number) {
    if (this.relayPongDeadlineTimer) clearTimeout(this.relayPongDeadlineTimer);
    this.relayPongDeadlineTimer = setTimeout(() => {
      if (socket !== this.ws) return;
      if (socket.readyState !== WebSocket.OPEN) return;
      this.pushDebug('keepalive_timeout', `connect#${connectId}`);
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    }, RELAY_PONG_TIMEOUT_MS);
  }

  private startRelayKeepalive(socket: WebSocket, connectId: number) {
    this.clearRelayKeepaliveTimers();
    this.refreshRelayPongDeadline(socket, connectId);

    socket.on('pong', () => {
      if (socket !== this.ws) return;
      this.pushDebug('keepalive_pong', `connect#${connectId}`);
      this.refreshRelayPongDeadline(socket, connectId);
    });

    this.relayPingTimer = setInterval(() => {
      if (socket !== this.ws) {
        this.clearRelayKeepaliveTimers();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.ping();
        this.pushDebug('keepalive_ping', `connect#${connectId}`);
      } catch {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }
    }, RELAY_PING_INTERVAL_MS);
  }

  connect(relayUrl: string, channelId: string): Promise<void> {
    const url = `${relayUrl}?channel=${channelId}&type=client`;
    const connectId = ++this.connectSeq;
    
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.clearRelayKeepaliveTimers();

      this.connected = false;
      this.figmaConnected = false;
      this.channelId = channelId;
      console.log(chalk.blue(`[MCP pid=${process.pid}] [connect#${connectId}] Connecting to relay server: ${url}`));
      this.pushDebug('connect_start', `connect#${connectId} url=${url}`);
      const socket = new WebSocket(url);
      this.ws = socket;
      let settled = false;
      let connectTimeout: NodeJS.Timeout | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (connectTimeout) clearTimeout(connectTimeout);
        fn();
      };

      socket.on('open', () => {
        if (socket !== this.ws) return;
        this.connected = true;
        this.startRelayKeepalive(socket, connectId);
        console.log(chalk.green(`[MCP pid=${process.pid}] [connect#${connectId}] ✓ Connected to relay (channel: ${channelId})`));
        this.pushDebug('socket_open', `connect#${connectId} channel=${channelId}`);

        connectTimeout = setTimeout(() => {
          if (!this.figmaConnected) {
            settle(() => reject(new Error(`Figma not connected to channel ${channelId}. Please open Figma plugin and enter channel ID: ${channelId}`)));
          }
        }, 30000);
      });

      socket.on('message', (data: WebSocket.Data) => {
        if (socket !== this.ws) return;
        this.refreshRelayPongDeadline(socket, connectId);
        const message = this.parseIncomingMessage(data);
        if (!message) return;

        // Handle system messages
        if (message.type === 'system') {
          console.log(chalk.gray(`[MCP pid=${process.pid}] [connect#${connectId}] system event=${String(message.event)} figmaConnected=${String(message.figmaConnected ?? '-')}`));
          this.pushDebug('system_event', `connect#${connectId} event=${String(message.event)} figmaConnected=${String(message.figmaConnected ?? '-')}`);
          if (message.event === 'connected') {
            this.figmaConnected = !!message.figmaConnected;
            if (this.figmaConnected) {
              console.log(chalk.green('✓ Figma plugin already connected'));
              settle(() => resolve());
            }
          } else if (message.event === 'figma_connected') {
            this.figmaConnected = true;
            console.log(chalk.green('✓ Figma plugin connected'));
            settle(() => resolve());
          } else if (message.event === 'figma_disconnected') {
            this.figmaConnected = false;
            console.log(chalk.yellow('! Figma plugin disconnected'));
            this.rejectAllPending(new Error('Figma plugin disconnected'));
          } else if (message.event === 'error') {
            const relayError = new Error(message.error || 'Relay server error');
            if (!this.figmaConnected) {
              settle(() => reject(relayError));
            }
            this.rejectAllPending(relayError);
          }
          return;
        }

        // Handle response messages
        const response: PluginResponse = message;
        this.handleResponse(response);
      });

      socket.on('close', () => {
        if (socket !== this.ws) return;
        this.clearRelayKeepaliveTimers();
        this.connected = false;
        this.figmaConnected = false;
        console.log(chalk.yellow(`[MCP pid=${process.pid}] [connect#${connectId}] ! Disconnected from relay`));
        this.pushDebug('socket_close', `connect#${connectId}`);
        this.rejectAllPending(new Error('Disconnected from relay server'));
        if (!settled) {
          settle(() => reject(new Error('Disconnected from relay server')));
        }
      });

      socket.on('error', (err) => {
        if (socket !== this.ws) return;
        this.clearRelayKeepaliveTimers();
        console.error(chalk.red(`[MCP pid=${process.pid}] [connect#${connectId}] socket error:`), err);
        this.pushDebug('socket_error', `connect#${connectId} err=${(err as any)?.message || String(err)}`);
        if (!settled) {
          settle(() => reject(err));
        }
      });
    });
  }

  private handleResponse(response: PluginResponse) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  send(message: PluginMessage, timeoutMs: number = 90000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Figma. Please open the "Supercharged Figma AI" plugin in Figma and click "Connect to MCP Server"'));
        return;
      }
      if (!this.figmaConnected) {
        reject(new Error('Figma plugin is not connected to this relay channel.'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingRequests.set(message.id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(message), (err) => {
        if (!err) return;
        clearTimeout(timeout);
        this.pendingRequests.delete(message.id);
        reject(err);
      });
    });
  }

  sendNotification(message: PluginMessage): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.figmaConnected) return;
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      // Best effort notification
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  isFigmaConnected(): boolean {
    return this.connected && this.figmaConnected;
  }

  getChannelId(): string | null {
    return this.channelId;
  }

  getDebugEvents(): Array<{ ts: string; event: string; detail?: string }> {
    return [...this.debugEvents];
  }

  setWebSocket(ws: WebSocket) {
    this.clearRelayKeepaliveTimers();
    this.ws = ws;
    this.connected = true;
    this.figmaConnected = true;
    
    ws.on('message', (data: WebSocket.Data) => {
      const response = this.parseIncomingMessage(data) as PluginResponse | null;
      if (!response) return;
      this.handleResponse(response);
    });

    ws.on('close', () => {
      this.clearRelayKeepaliveTimers();
      this.connected = false;
      this.figmaConnected = false;
      this.channelId = null;
      this.rejectAllPending(new Error('Figma Plugin disconnected'));
      console.log(chalk.yellow('! Figma Plugin disconnected'));
    });

    ws.on('error', (err) => {
      this.clearRelayKeepaliveTimers();
      console.error(chalk.red('WebSocket error:'), err);
    });

  }
}

// Tool Definitions
const TOOLS: Tool[] = [
  // ===== System Tools =====
  {
    name: 'connect_to_relay',
    description: 'Connect to Figma via Relay Server. Prerequisite: user must open the Figma plugin first and provide a real Channel Code. NEVER guess/fabricate channelCode. If missing, ask user to provide: connect_to_relay {"relayUrl":"ws://127.0.0.1:8888","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}. Use wss:// for remote production relay endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        relayUrl: {
          type: 'string',
          description: 'Optional. Relay WebSocket URL (e.g., ws://127.0.0.1:8080). If omitted, server default is used.',
        },
        channelCode: {
          type: 'string',
          description: 'Required. Real Channel Code displayed in Figma plugin (e.g., ABC123). Do not invent values.',
        },
      },
      required: ['channelCode'],
    },
  },
  {
    name: 'get_connection_status',
    description: 'Check MCP<->Figma connection state before any design tool call. Supports optional debug event controls to reduce noisy payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        includeDebugEvents: {
          type: 'boolean',
          default: false,
          description: 'Whether to include relay debugEvents in response.',
        },
        debugLimit: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 200,
          description: 'Max number of newest debug events to include when includeDebugEvents=true.',
        },
      },
    },
  },
  // ===== Smart Discovery Tools =====
  {
    name: 'smart_select',
    description: 'AI-powered semantic node retrieval using natural language query (fuzzy, not exact-match filtering). Supports current page, whole document, or explicit pageIds/pageNames. For deterministic exact filtering, prefer scan_by_pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query, e.g., "all buttons", "login form elements", "red cards in header"',
        },
        scope: {
          type: 'string',
          enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'],
          default: 'document',
          description: 'Search scope when pageIds/pageNames are not provided.',
        },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to search. Takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to search (case-insensitive). Takes precedence over scope.' },
        limit: {
          type: 'number',
          default: 100,
          description: 'Maximum results to return',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar',
    description: 'Find nodes visually or structurally similar to a target node. Supports current page, whole document, or explicit pageIds/pageNames.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: {
          type: 'string',
          description: 'ID of the reference node',
        },
        threshold: {
          type: 'number',
          default: 0.85,
          minimum: 0,
          maximum: 1,
          description: 'Similarity threshold (0-1)',
        },
        scope: {
          type: 'string',
          enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'],
          default: 'document',
          description: 'Search scope when pageIds/pageNames are not provided.',
        },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to search. Takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to search (case-insensitive). Takes precedence over scope.' },
      },
      required: ['targetId'],
    },
  },
  {
    name: 'scan_by_pattern',
    description: 'Scan nodes by pattern (name/type/size/color/layout). Supports current page, whole document, or explicit pageIds/pageNames. Returns paginated-like payload with `nodes` and truncation metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'object',
          properties: {
            nameRegex: { type: 'string' },
            types: { type: 'array', items: { type: 'string' } },
            minWidth: { type: 'number' },
            maxWidth: { type: 'number' },
            minHeight: { type: 'number' },
            maxHeight: { type: 'number' },
            fillColor: { type: 'object' },
            hasAutoLayout: { type: 'boolean' },
          },
        },
        limit: {
          type: 'number',
          default: 200,
          minimum: 1,
          maximum: 5000,
          description: 'Maximum matched nodes to return. Use to prevent oversized responses on large documents.',
        },
        scope: {
          type: 'string',
          enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'],
          default: 'document',
          description: 'Search scope when pageIds/pageNames are not provided.',
        },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to scan. Takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to scan (case-insensitive). Takes precedence over scope.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'auto_discover_components',
    description: 'Automatically analyze nodes and discover opportunities for component creation. Supports current page, whole document, or explicit pageIds/pageNames.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'],
          default: 'page',
          description: 'Analysis scope when pageIds/pageNames are not provided.',
        },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to analyze. Takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to analyze (case-insensitive). Takes precedence over scope.' },
        minSimilarity: { type: 'number', default: 0.9 },
        minOccurrences: { type: 'number', default: 3 },
      },
    },
  },

  // ===== Batch Operation Tools =====
  {
    name: 'batch_create',
    description: 'Batch create multiple nodes efficiently. Handles 1000+ operations without timeout. `operation.type` accepts alias formats: snake_case, camelCase, kebab-case, and uppercase.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Create type alias. Supported families: rectangle/frame/text/component/ellipse/line/polygon/star/vector. Examples: `create_frame`, `createFrame`, `frame`.',
              },
              params: {
                type: 'object',
                description: 'Node properties. Paint arrays (`fills`/`strokes`) support either hex strings (e.g. `#4A90E2`) or full Figma paint objects.',
              },
            },
          },
        },
        chunkSize: { type: 'number', default: 50 },
        continueOnError: { type: 'boolean', default: true },
      },
      required: ['operations'],
    },
  },
  {
    name: 'batch_modify',
    description: 'Batch modify multiple nodes in one operation.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              changes: { type: 'object' },
            },
          },
        },
        chunkSize: { type: 'number', default: 50 },
      },
      required: ['operations'],
    },
  },
  {
    name: 'batch_clone',
    description: 'Clone a template node multiple times with optional position offset. For large counts, IDs are optional and can be truncated to keep payloads small.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        count: { type: 'number' },
        offsetX: { type: 'number', default: 200 },
        offsetY: { type: 'number', default: 0 },
        gridColumns: { type: 'number', default: 5 },
        includeIds: { type: 'boolean', default: false, description: 'Whether to include cloned node IDs in the response.' },
        maxReturnedIds: { type: 'number', default: 100, minimum: 0, maximum: 5000, description: 'Maximum number of IDs returned when includeIds=true.' },
      },
      required: ['templateId', 'count'],
    },
  },
  {
    name: 'batch_rename',
    description: 'Batch rename nodes with pattern support.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        pattern: { type: 'string', description: 'Name pattern with {index} placeholder' },
        startIndex: { type: 'number', default: 1 },
      },
      required: ['nodeIds', 'pattern'],
    },
  },
  {
    name: 'batch_delete',
    description: 'Batch delete multiple nodes safely.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        confirm: { type: 'boolean', default: false },
      },
      required: ['nodeIds'],
    },
  },

  // ===== Component System Tools =====
  {
    name: 'create_component_from_nodes',
    description: 'Convert multiple nodes into a component. Can organize similar nodes automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        organize: { type: 'boolean', default: true, description: 'Organize components on a dedicated page' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'create_variant_set',
    description: 'Create a component set with variants from multiple components.',
    inputSchema: {
      type: 'object',
      properties: {
        componentIds: { type: 'array', items: { type: 'string' } },
        propertyName: { type: 'string' },
        propertyValues: { type: 'array', items: { type: 'string' } },
      },
      required: ['componentIds', 'propertyName', 'propertyValues'],
    },
  },
  {
    name: 'auto_create_variants',
    description: 'Intelligently analyze a component and auto-generate variants based on property differences.',
    inputSchema: {
      type: 'object',
      properties: {
        componentId: { type: 'string' },
        detectProperties: { type: 'array', items: { type: 'string' }, default: ['fills', 'text', 'visibility'] },
      },
      required: ['componentId'],
    },
  },
  {
    name: 'merge_to_component',
    description: 'Intelligently merge similar nodes into a component, creating instances to replace originals.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        smartMatch: { type: 'boolean', default: true, description: 'Auto-group similar nodes' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'detach_instance',
    description: 'Detach component instances and optionally delete the main component.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: { type: 'array', items: { type: 'string' } },
        deleteMainComponent: { type: 'boolean', default: false },
      },
      required: ['instanceIds'],
    },
  },
  {
    name: 'swap_component',
    description: 'Swap multiple instances to a different component.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: { type: 'array', items: { type: 'string' } },
        newComponentKey: { type: 'string' },
        preserveOverrides: { type: 'boolean', default: true },
      },
      required: ['instanceIds', 'newComponentKey'],
    },
  },

  // ===== Prototype System Tools =====
  {
    name: 'create_interaction',
    description: 'Create a prototype interaction between two nodes (strict mode). Source must support reactions (recommended FRAME/INSTANCE). Supported trigger types: ON_CLICK, ON_HOVER, ON_PRESS, AFTER_TIMEOUT, MOUSE_UP, MOUSE_DOWN, MOUSE_ENTER, MOUSE_LEAVE, ON_MEDIA_END. ON_DRAG/keyboard triggers are currently unsupported and are rejected explicitly. Supported action types: NODE, BACK, CLOSE, URL. For NODE actions, destinationId/navigation/transition must be valid. Unsupported types are rejected with explicit errors (no silent downgrade).',
    inputSchema: {
      type: 'object',
      properties: {
        fromNodeId: { type: 'string' },
        toNodeId: { type: 'string' },
        trigger: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'AFTER_TIMEOUT', 'MOUSE_UP', 'MOUSE_DOWN', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'ON_MEDIA_END'] },
            delay: { type: 'number' },
            timeout: { type: 'number' },
          },
        },
        action: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['NODE', 'BACK', 'CLOSE', 'URL', 'OPEN_LINK'] },
            navigation: { type: 'string', enum: ['NAVIGATE', 'OVERLAY', 'SWAP', 'SCROLL_TO', 'CHANGE_TO'] },
            destinationId: { type: 'string' },
            url: { type: 'string' },
            animation: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['DISSOLVE', 'SMART_ANIMATE', 'MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'] },
                direction: { type: 'string', enum: ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'] },
                matchLayers: { type: 'boolean' },
                duration: { type: 'number' },
                easing: { type: 'string', enum: ['EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'LINEAR'] },
              },
            },
            transition: { type: 'object' },
            preserveScrollPosition: { type: 'boolean' },
            resetScrollPosition: { type: 'boolean' },
            resetVideoPosition: { type: 'boolean' },
            resetInteractiveComponents: { type: 'boolean' },
          },
        },
      },
      required: ['fromNodeId', 'toNodeId'],
    },
  },
  {
    name: 'batch_connect',
    description: 'Batch create prototype connections.',
    inputSchema: {
      type: 'object',
      properties: {
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromNodeId: { type: 'string' },
              toNodeId: { type: 'string' },
              trigger: { type: 'object' },
              action: { type: 'object' },
            },
          },
        },
      },
      required: ['connections'],
    },
  },
  {
    name: 'copy_prototype',
    description: 'Copy prototype interactions from one node to others.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceNodeId: { type: 'string' },
        targetNodeIds: { type: 'array', items: { type: 'string' } },
        adjustTargets: { type: 'boolean', default: true, description: 'Auto-adjust destination based on target context' },
      },
      required: ['sourceNodeId', 'targetNodeIds'],
    },
  },
  {
    name: 'create_flow',
    description: 'Create a prototype flow with a starting frame.',
    inputSchema: {
      type: 'object',
      properties: {
        startFrameId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['startFrameId', 'name'],
    },
  },

  // ===== Style System Tools =====
  {
    name: 'create_color_style',
    description: 'Create a color style from a node or direct values.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'object', properties: { r: {}, g: {}, b: {}, a: {} } },
        sourceNodeId: { type: 'string' },
      },
    },
  },
  {
    name: 'create_text_style',
    description: 'Create a text style from a text node.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sourceNodeId: { type: 'string' },
      },
      required: ['name', 'sourceNodeId'],
    },
  },
  {
    name: 'apply_style_to_nodes',
    description: 'Apply a style to multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        styleId: { type: 'string' },
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['styleId', 'nodeIds'],
    },
  },
  {
    name: 'sync_styles_to_library',
    description: 'Sync local styles to a team library.',
    inputSchema: {
      type: 'object',
      properties: {
        styleIds: { type: 'array', items: { type: 'string' } },
        libraryFileKey: { type: 'string' },
      },
      required: ['styleIds'],
    },
  },

  // ===== Intelligence Tools =====
  {
    name: 'analyze_duplicates',
    description: 'Analyze duplicate/similar elements and return consolidation opportunities. Scope can target current page, whole document, or explicit pageIds/pageNames. Supports output caps for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'], default: 'document' },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to analyze. If provided, takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to analyze (case-insensitive). If provided, takes precedence over scope.' },
        threshold: { type: 'number', default: 0.9 },
        minOccurrences: { type: 'number', default: 2 },
        maxGroups: { type: 'number', default: 100, minimum: 1, maximum: 1000, description: 'Maximum duplicate groups returned.' },
        maxNodesPerGroup: { type: 'number', default: 50, minimum: 1, maximum: 200, description: 'Maximum node references returned per duplicate group.' },
        maxAnalyzedNodes: { type: 'number', default: 5000, minimum: 100, maximum: 50000, description: 'Hard limit for analyzed nodes to prevent timeouts on very large documents.' },
      },
    },
  },
  {
    name: 'suggest_component_structure',
    description: 'Analyze design and suggest optimal component structure. Scope can target current page, whole document, or explicit pageIds/pageNames.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'], default: 'document' },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to analyze. If provided, takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to analyze (case-insensitive). If provided, takes precedence over scope.' },
        maxDepth: { type: 'number', default: 3 },
      },
    },
  },
  {
    name: 'generate_naming_scheme',
    description: 'Generate consistent naming scheme for nodes based on patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        convention: { type: 'string', enum: ['semantic', 'functional', 'atomic'], default: 'semantic' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'check_consistency',
    description: 'Check design consistency (spacing, colors, typography). Scope can target current page, whole document, or explicit pageIds/pageNames.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['page', 'current_page', 'currentPage', 'current-page', 'selected_nodes', 'selected-nodes', 'selectedNodes', 'selection', 'document'], default: 'document' },
        pageIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page IDs to analyze. If provided, takes precedence over scope.' },
        pageNames: { type: 'array', items: { type: 'string' }, description: 'Optional explicit page names to analyze (case-insensitive). If provided, takes precedence over scope.' },
        checks: { type: 'array', items: { type: 'string' }, default: ['colors', 'typography', 'spacing'] },
      },
    },
  },
  {
    name: 'select_nodes',
    description: 'Select nodes by IDs on canvas. Selection is applied on the active page; cross-page IDs are reported in skippedCrossPageIds. Can optionally append to current selection and focus viewport.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        append: { type: 'boolean', default: false },
        focus: { type: 'boolean', default: true },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'set_focus',
    description: 'Set viewport focus by node(s) or by canvas coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        nodeIds: { type: 'array', items: { type: 'string' } },
        x: { type: 'number' },
        y: { type: 'number' },
        zoom: { type: 'number' },
      },
    },
  },
  {
    name: 'move_nodes',
    description: 'Move multiple nodes by delta offsets. Operates by node ID globally (can move nodes on different pages in one call).',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        deltaX: { type: 'number', default: 0 },
        deltaY: { type: 'number', default: 0 },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'set_node_position',
    description: 'Set absolute x/y position for a single node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['nodeId', 'x', 'y'],
    },
  },
  {
    name: 'arrange_nodes',
    description: 'Auto-arrange nodes into row/column/grid with optional collision avoidance, geometric quality checks, and optional before/after visual snapshots. Returns strict diagnostics via missingIds + missingDetails (reasons: not_found/not_positionable/missing_bounds/cross_page_filtered).',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional. If omitted, uses current selection.' },
        layout: { type: 'string', enum: ['row', 'column', 'grid'], default: 'row' },
        columns: { type: 'number', description: 'Used when layout=grid. Auto-calculated if omitted.' },
        groupBy: {
          type: 'string',
          enum: ['none', 'type', 'typeAndComponent'],
          default: 'none',
          description: 'When set to type/typeAndComponent, nodes are grouped by layer type and optionally component name before arranging.'
        },
        spacingX: { type: 'number', default: 120 },
        spacingY: { type: 'number', default: 120 },
        startX: { type: 'number', description: 'Optional fixed start X. Defaults to min x of selected nodes.' },
        startY: { type: 'number', description: 'Optional fixed start Y. Defaults to min y of selected nodes.' },
        withinContainerId: { type: 'string', description: 'Optional container/frame to keep nodes inside and parent under.' },
        placementPolicy: { type: 'string', enum: ['preserve_lane', 'min_move', 'strict_no_overlap'], default: 'min_move', description: 'Collision resolution strategy; min_move keeps nodes closer to original area.' },
        avoidOverlaps: { type: 'boolean', default: true, description: 'When true, shifts candidates to avoid overlaps with non-target nodes.' },
        verifyVisual: { type: 'boolean', default: false, description: 'When true, capture before/after snapshots and include quality metrics.' },
        snapshotMode: { type: 'string', enum: ['selection', 'region', 'page'], default: 'selection', description: 'Capture mode used when verifyVisual=true.' },
        snapshotScale: { type: 'number', default: 1, description: 'Export scale for snapshots.' },
        focus: { type: 'boolean', default: true, description: 'Focus viewport to arranged nodes after operation.' },
      },
    },
  },
  {
    name: 'containerize_nodes',
    description: 'Reparent nodes into a target container while preserving their visual position as much as possible.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        containerId: { type: 'string' },
      },
      required: ['nodeIds', 'containerId'],
    },
  },
  {
    name: 'validate_structure',
    description: 'Validate container membership, bounds containment, and overlap for a set of nodes. Useful after layout operations.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional. If omitted, uses current selection.' },
        containerId: { type: 'string', description: 'Optional container to validate parent/inside status.' },
      },
    },
  },
  {
    name: 'capture_view',
    description: 'Capture a visual snapshot as PNG for selected nodes, a region, or current page, and return metadata + base64 preview.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['selection', 'region', 'page'], default: 'selection' },
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional for mode=selection. Defaults to current selection.' },
        x: { type: 'number', description: 'Required for mode=region.' },
        y: { type: 'number', description: 'Required for mode=region.' },
        width: { type: 'number', description: 'Required for mode=region.' },
        height: { type: 'number', description: 'Required for mode=region.' },
        scale: { type: 'number', default: 1 },
        includeBase64: { type: 'boolean', default: true, description: 'Return truncated base64 preview for quick validation.' },
        maxBase64Length: { type: 'number', default: 400, description: 'Maximum returned base64 length when includeBase64=true.' },
      },
    },
  },

  // ===== Utility Tools =====
  {
    name: 'get_document_info',
    description: 'Get document/page structure with configurable output caps to avoid oversized payloads on large files.',
    inputSchema: {
      type: 'object',
      properties: {
        includeChildren: { type: 'boolean', default: true },
        maxDepth: { type: 'number', default: 10 },
        maxPages: { type: 'number', default: 100, minimum: 1, maximum: 500, description: 'Maximum pages returned.' },
        maxNodesPerPage: { type: 'number', default: 1200, minimum: 100, maximum: 10000, description: 'Maximum descendant nodes returned per page when includeChildren=true.' },
        maxChildrenPerNode: { type: 'number', default: 200, minimum: 20, maximum: 1000, description: 'Maximum direct children returned for each node in tree output.' },
      },
    },
  },
  {
    name: 'get_node_info',
    description: 'Get detailed info about a node including children.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        includeChildren: { type: 'boolean', default: true },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'get_selection',
    description: 'Get the current selection on the active page, including node metadata for each selected node',
    inputSchema: {
      type: 'object',
      properties: {
        includeChildren: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'set_multiple_text_contents',
    description: 'Update multiple text nodes at once.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              text: { type: 'string' },
            },
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'undo_operations',
    description: 'Rollback recent operations using Figma undo stack. operationId is optional metadata; steps controls how many undo levels to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string' },
        steps: { type: 'number', default: 1 },
      },
    },
  },
  {
    name: 'apply_style_preset',
    description: 'Apply designer-oriented visual presets (gradient button, glass panel, glow, shadow, blur) to multiple nodes with parameter overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        preset: {
          type: 'string',
          enum: [
            'button_gradient_primary',
            'button_gradient_vivid',
            'card_soft_shadow',
            'panel_glass',
            'hero_glow',
            'backdrop_blur_soft',
          ],
        },
        options: { type: 'object' },
      },
      required: ['nodeIds', 'preset'],
    },
  },

  // ===== NEW: Frame to Components Tools =====
  {
    name: 'frame_to_components',
    description: 'Intelligently split a Frame\'s children into components. Analyzes children, groups similar ones, and converts them to components.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'ID of the Frame to analyze' },
        strategy: { 
          type: 'string', 
          enum: ['smart', 'by_type', 'by_name', 'all_children'],
          default: 'smart',
          description: 'Grouping strategy'
        },
        groupSimilar: { type: 'boolean', default: true },
        createVariants: { type: 'boolean', default: false },
        organizeOnPage: { type: 'boolean', default: true },
        minSize: { 
          type: 'object', 
          properties: { width: { type: 'number' }, height: { type: 'number' } },
          default: { width: 50, height: 30 }
        },
        excludeTypes: { type: 'array', items: { type: 'string' } },
      },
      required: ['frameId'],
    },
  },
  {
    name: 'analyze_frame_structure',
    description: 'Analyze a Frame\'s structure and suggest component opportunities.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string' },
        detectDuplicates: { type: 'boolean', default: true },
        minSimilarity: { type: 'number', default: 0.85 },
      },
      required: ['frameId'],
    },
  },

  // ===== NEW: Cross-Page Operations Tools =====
  {
    name: 'cross_page_copy',
    description: 'Copy nodes from one page to another.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        sourcePageId: { type: 'string' },
        targetPageId: { type: 'string' },
        maintainPosition: { type: 'boolean', default: true },
      },
      required: ['nodeIds', 'sourcePageId', 'targetPageId'],
    },
  },
  {
    name: 'cross_page_move',
    description: 'Move nodes from one page to another.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        sourcePageId: { type: 'string' },
        targetPageId: { type: 'string' },
        maintainPosition: { type: 'boolean', default: true },
      },
      required: ['nodeIds', 'sourcePageId', 'targetPageId'],
    },
  },
  {
    name: 'batch_edit_across_pages',
    description: 'Apply the same edits to nodes across multiple pages.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageId: { type: 'string' },
              nodeId: { type: 'string' },
              changes: { type: 'object' },
            },
          },
        },
      },
      required: ['operations'],
    },
  },

  // ===== NEW: Component Set Management =====
  {
    name: 'explode_component_set',
    description: 'Explode a component set into separate components.',
    inputSchema: {
      type: 'object',
      properties: {
        componentSetId: { type: 'string' },
        convertInstancesToMain: { type: 'boolean', default: false },
        organizeOnPage: { type: 'boolean', default: true },
      },
      required: ['componentSetId'],
    },
  },
  {
    name: 'detach_and_organize',
    description: 'Detach instances and organize the detached nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: { type: 'array', items: { type: 'string' } },
        deleteMainComponent: { type: 'boolean', default: false },
        organizeBy: { type: 'string', enum: ['type', 'name', 'size', 'page_location'], default: 'type' },
        createBackup: { type: 'boolean', default: true },
      },
      required: ['instanceIds'],
    },
  },
  {
    name: 'convert_instances_to_components',
    description: 'Convert existing instances to new independent components.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: { type: 'array', items: { type: 'string' } },
        namingPattern: { type: 'string', default: '{original}_Component' },
        organizeOnPage: { type: 'boolean', default: true },
      },
      required: ['instanceIds'],
    },
  },

  // ===== NEW: Advanced Component Operations =====
  {
    name: 'split_component_by_variants',
    description: 'Split a component with variants back into separate components.',
    inputSchema: {
      type: 'object',
      properties: {
        componentSetId: { type: 'string' },
        keepComponentSet: { type: 'boolean', default: false },
        updateInstances: { type: 'boolean', default: true },
      },
      required: ['componentSetId'],
    },
  },
  {
    name: 'merge_components_to_set',
    description: 'Merge multiple standalone components into a variant set.',
    inputSchema: {
      type: 'object',
      properties: {
        componentIds: { type: 'array', items: { type: 'string' } },
        variantProperty: { type: 'string', default: 'Type' },
        autoDetectValues: { type: 'boolean', default: true },
      },
      required: ['componentIds'],
    },
  },

  // ===== Basic Node Creation =====
  {
    name: 'create_ellipse',
    description: 'Create an ellipse or circle.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
        fills: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_line',
    description: 'Create a line.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        strokeWeight: { type: 'number' },
        strokes: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_polygon',
    description: 'Create a regular polygon.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        pointCount: { type: 'number', default: 5 },
        fills: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_star',
    description: 'Create a star shape.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        pointCount: { type: 'number', default: 5 },
        innerRadius: { type: 'number', default: 0.5 },
        fills: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_vector',
    description: 'Create a vector path. Supports vector path aliases (`vectorPaths`/`vectorPath`/`path`/`svgPath`/`d`) with object or SVG-string inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        vectorPaths: { type: ['array', 'object', 'string'] as any, description: 'Can be a VectorPath object, array of VectorPath objects, or SVG path string(s).' } as any,
        vectorPath: { type: ['object', 'string'] as any, description: 'Alias of vectorPaths.' } as any,
        path: { type: ['object', 'string'] as any, description: 'Alias of vectorPaths.' } as any,
        svgPath: { type: ['object', 'string'] as any, description: 'Alias of vectorPaths.' } as any,
        d: { type: ['object', 'string'] as any, description: 'Alias of vectorPaths.' } as any,
        fills: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        strokes: { type: 'array', description: 'Paint array. Supports hex strings and paint objects.' },
        strokeWeight: { type: 'number' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_group',
    description: 'Group multiple nodes together.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'create_section',
    description: 'Create a section container.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
        fills: { type: 'array' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_slice',
    description: 'Create a slice for export.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_connector',
    description: 'Create a connector line between nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        startNodeId: { type: 'string' },
        endNodeId: { type: 'string' },
        startMagnet: { type: 'string', enum: ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'AUTO'] },
        endMagnet: { type: 'string', enum: ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'AUTO'] },
        strokeWeight: { type: 'number' },
        strokes: { type: 'array' },
      },
      required: ['startNodeId', 'endNodeId'],
    },
  },
  {
    name: 'create_sticky',
    description: 'Create a sticky note (FigJam).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' },
        color: { type: 'string', enum: ['YELLOW', 'GREEN', 'BLUE', 'ORANGE', 'PINK', 'PURPLE', 'GRAY'] },
        parentId: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'create_shape_with_text',
    description: 'Create a shape with text (FigJam).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        shapeType: { type: 'string', enum: ['SQUARE', 'ELLIPSE', 'ROUNDED_RECTANGLE', 'DIAMOND', 'TRIANGLE_UP', 'TRIANGLE_DOWN', 'PARALLELOGRAM_RIGHT', 'PARALLELOGRAM_LEFT'] },
        text: { type: 'string' },
        fills: { type: 'array' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_table',
    description: 'Create a table.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        rowCount: { type: 'number', default: 3 },
        columnCount: { type: 'number', default: 3 },
        cellWidth: { type: 'number', default: 100 },
        cellHeight: { type: 'number', default: 40 },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },

  // ===== Boolean Operations =====
  {
    name: 'union_nodes',
    description: 'Perform union boolean operation on multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'subtract_nodes',
    description: 'Perform subtract boolean operation on multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'intersect_nodes',
    description: 'Perform intersect boolean operation on multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'exclude_nodes',
    description: 'Perform exclude boolean operation on multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'flatten_nodes',
    description: 'Flatten multiple nodes into a single vector network.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        parentId: { type: 'string' },
      },
      required: ['nodeIds'],
    },
  },

  // ===== Node Properties =====
  {
    name: 'set_constraints',
    description: 'Set constraints for a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        horizontal: { type: 'string', enum: ['MIN', 'MAX', 'STRETCH', 'SCALE', 'CENTER'] },
        vertical: { type: 'string', enum: ['MIN', 'MAX', 'STRETCH', 'SCALE', 'CENTER'] },
      },
      required: ['nodeId', 'horizontal', 'vertical'],
    },
  },
  {
    name: 'set_layout_grid',
    description: 'Set layout grids for a frame.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        layoutGrids: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pattern: { type: 'string', enum: ['COLUMNS', 'ROWS', 'GRID'] },
              sectionSize: { type: 'number' },
              visible: { type: 'boolean' },
              color: { type: 'object' },
              alignment: { type: 'string', enum: ['MIN', 'MAX', 'STRETCH', 'CENTER'] },
              gutterSize: { type: 'number' },
              offset: { type: 'number' },
              count: { type: 'number' },
            },
          },
        },
      },
      required: ['nodeId', 'layoutGrids'],
    },
  },
  {
    name: 'set_effects',
    description: 'Set effects (shadows, blurs) for a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        effects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['INNER_SHADOW', 'DROP_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'] },
              color: { type: 'object' },
              offset: { type: 'object' },
              radius: { type: 'number' },
              spread: { type: 'number' },
              visible: { type: 'boolean' },
              blendMode: { type: 'string' },
            },
          },
        },
      },
      required: ['nodeId', 'effects'],
    },
  },
  {
    name: 'set_export_settings',
    description: 'Set export settings for a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        exportSettings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              suffix: { type: 'string' },
              format: { type: 'string', enum: ['PNG', 'SVG', 'PDF', 'JPG'] },
              constraint: { type: 'object' },
            },
          },
        },
      },
      required: ['nodeId', 'exportSettings'],
    },
  },
  {
    name: 'set_blend_mode',
    description: 'Set blend mode for a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        blendMode: { type: 'string', enum: ['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN', 'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'] },
      },
      required: ['nodeId', 'blendMode'],
    },
  },
  {
    name: 'set_mask',
    description: 'Set or remove mask on a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        isMask: { type: 'boolean' },
        maskType: { type: 'string', enum: ['ALPHA', 'VECTOR', 'LUMINANCE'] },
      },
      required: ['nodeId', 'isMask'],
    },
  },

  // ===== Auto Layout Enhancement =====
  {
    name: 'set_auto_layout',
    description: 'Comprehensive auto layout configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'] },
        primaryAxisAlignItems: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'] },
        counterAxisAlignItems: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'BASELINE'] },
        paddingTop: { type: 'number' },
        paddingRight: { type: 'number' },
        paddingBottom: { type: 'number' },
        paddingLeft: { type: 'number' },
        itemSpacing: { type: 'number' },
        counterAxisSpacing: { type: 'number' },
        layoutWrap: { type: 'string', enum: ['NO_WRAP', 'WRAP'] },
        width: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] },
        height: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] },
      },
      required: ['nodeId', 'layoutMode'],
    },
  },
  {
    name: 'remove_auto_layout',
    description: 'Remove auto layout from a frame.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        keepPosition: { type: 'boolean', default: true },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'align_nodes',
    description: 'Align multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        alignment: { type: 'string', enum: ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'MIDDLE_LEFT', 'MIDDLE_CENTER', 'MIDDLE_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT'] },
      },
      required: ['nodeIds', 'alignment'],
    },
  },
  {
    name: 'distribute_nodes',
    description: 'Evenly distribute nodes horizontally or vertically.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        direction: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL'] },
        spacing: { type: 'number' },
      },
      required: ['nodeIds', 'direction'],
    },
  },

  // ===== Style System Complete =====
  {
    name: 'create_effect_style',
    description: 'Create an effect style.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        effects: { type: 'array' },
        sourceNodeId: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_grid_style',
    description: 'Create a layout grid style.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        layoutGrids: { type: 'array' },
        sourceNodeId: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_paint_style',
    description: 'Update an existing paint style.',
    inputSchema: {
      type: 'object',
      properties: {
        styleId: { type: 'string' },
        name: { type: 'string' },
        paints: { type: 'array' },
      },
      required: ['styleId'],
    },
  },
  {
    name: 'update_text_style',
    description: 'Update an existing text style.',
    inputSchema: {
      type: 'object',
      properties: {
        styleId: { type: 'string' },
        name: { type: 'string' },
        fontName: { type: 'object' },
        fontSize: { type: 'number' },
        lineHeight: { type: 'object' },
        letterSpacing: { type: 'object' },
      },
      required: ['styleId'],
    },
  },
  {
    name: 'delete_style',
    description: 'Delete a style.',
    inputSchema: {
      type: 'object',
      properties: {
        styleId: { type: 'string' },
        detachNodes: { type: 'boolean', default: true },
      },
      required: ['styleId'],
    },
  },
  {
    name: 'get_all_styles',
    description: 'Get all styles in the document.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['PAINT', 'TEXT', 'EFFECT', 'GRID'] },
      },
    },
  },

  // ===== Variables System =====
  {
    name: 'create_variable',
    description: 'Create a variable.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] },
        value: {},
        collectionId: { type: 'string' },
      },
      required: ['name', 'type', 'collectionId'],
    },
  },
  {
    name: 'create_variable_collection',
    description: 'Create a variable collection.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        modes: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
  },
  {
    name: 'set_variable_value',
    description: 'Set a variable value for a specific mode.',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: { type: 'string' },
        modeId: { type: 'string' },
        value: {},
      },
      required: ['variableId', 'modeId', 'value'],
    },
  },
  {
    name: 'bind_variable_to_node',
    description: 'Bind a variable to a node property.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        variableId: { type: 'string' },
        property: { type: 'string', enum: ['FILLS', 'STROKES', 'EFFECTS', 'OPACITY', 'WIDTH', 'HEIGHT', 'VISIBLE', 'TEXT'] },
      },
      required: ['nodeId', 'variableId', 'property'],
    },
  },
  {
    name: 'unbind_variable',
    description: 'Unbind a variable from a node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        property: { type: 'string' },
      },
      required: ['nodeId', 'property'],
    },
  },
  {
    name: 'get_all_variables',
    description: 'Get all variables and collections.',
    inputSchema: {
      type: 'object',
    },
  },
  {
    name: 'delete_variable',
    description: 'Delete a variable.',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: { type: 'string' },
        unbindNodes: { type: 'boolean', default: true },
      },
      required: ['variableId'],
    },
  },

  // ===== Page Management =====
  {
    name: 'create_page',
    description: 'Create a new page.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        index: { type: 'number' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_page',
    description: 'Delete a page. If the target is current page, the plugin switches to another page first. Cannot delete the last remaining page.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        confirm: { type: 'boolean', default: false },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'rename_page',
    description: 'Rename a page.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        newName: { type: 'string' },
      },
      required: ['pageId', 'newName'],
    },
  },
  {
    name: 'reorder_pages',
    description: 'Reorder pages.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['pageIds'],
    },
  },
  {
    name: 'duplicate_page',
    description: 'Duplicate a page with all its content.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        newName: { type: 'string' },
      },
      required: ['pageId'],
    },
  },

  // ===== Media & Export =====
  {
    name: 'create_image_fill',
    description: 'Create an image fill from URL or bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        hash: { type: 'string' },
        nodeId: { type: 'string', description: 'Node to apply image fill to' },
      },
    },
  },
  {
    name: 'export_node',
    description: 'Export a node as image/SVG/PDF.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        format: { type: 'string', enum: ['PNG', 'SVG', 'PDF', 'JPG'] },
        scale: { type: 'number', default: 1 },
        suffix: { type: 'string' },
      },
      required: ['nodeId', 'format'],
    },
  },
  {
    name: 'export_nodes_batch',
    description: 'Export multiple nodes at once.',
    inputSchema: {
      type: 'object',
      properties: {
        exports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              format: { type: 'string' },
              scale: { type: 'number' },
              suffix: { type: 'string' },
            },
          },
        },
      },
      required: ['exports'],
    },
  },

  // ===== Component Properties =====
  {
    name: 'add_component_property',
    description: 'Add a property to a component.',
    inputSchema: {
      type: 'object',
      properties: {
        componentId: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT'] },
        defaultValue: {},
      },
      required: ['componentId', 'name', 'type'],
    },
  },
  {
    name: 'set_component_property',
    description: 'Set a component property value on an instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string' },
        propertyName: { type: 'string' },
        value: {},
      },
      required: ['instanceId', 'propertyName', 'value'],
    },
  },
  {
    name: 'remove_component_property',
    description: 'Remove a property from a component.',
    inputSchema: {
      type: 'object',
      properties: {
        componentId: { type: 'string' },
        propertyName: { type: 'string' },
      },
      required: ['componentId', 'propertyName'],
    },
  },

  // ===== Transform Operations =====
  {
    name: 'scale_nodes',
    description: 'Scale multiple nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        scaleX: { type: 'number' },
        scaleY: { type: 'number' },
        center: { type: 'object' },
      },
      required: ['nodeIds', 'scaleX', 'scaleY'],
    },
  },
  {
    name: 'flip_horizontal',
    description: 'Flip nodes horizontally.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'flip_vertical',
    description: 'Flip nodes vertically.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['nodeIds'],
    },
  },

  // ===== Advanced Import/Export =====
  {
    name: 'import_component_from_file',
    description: 'Import a component from another Figma file.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        componentKey: { type: 'string' },
      },
      required: ['fileKey', 'componentKey'],
    },
  },
  {
    name: 'import_style_from_file',
    description: 'Import a style from another Figma file.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        styleKey: { type: 'string' },
      },
      required: ['fileKey', 'styleKey'],
    },
  },

  // ===== REST API Bridge (Cross-Project Operations) =====
  {
    name: 'rest_get_file',
    description: 'Get file data via REST API (for cross-project operations). Requires Figma access token.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        accessToken: { type: 'string' },
        version: { type: 'string' },
        depth: { type: 'number' },
      },
      required: ['fileKey', 'accessToken'],
    },
  },
  {
    name: 'rest_get_file_nodes',
    description: 'Get specific nodes from a file via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        nodeIds: { type: 'array', items: { type: 'string' } },
        accessToken: { type: 'string' },
      },
      required: ['fileKey', 'nodeIds', 'accessToken'],
    },
  },
  {
    name: 'rest_get_team_components',
    description: 'Get team component library via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        accessToken: { type: 'string' },
      },
      required: ['teamId', 'accessToken'],
    },
  },
  {
    name: 'rest_get_file_components',
    description: 'Get components from a file via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        accessToken: { type: 'string' },
      },
      required: ['fileKey', 'accessToken'],
    },
  },
  {
    name: 'rest_get_team_styles',
    description: 'Get team styles via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        accessToken: { type: 'string' },
      },
      required: ['teamId', 'accessToken'],
    },
  },
  {
    name: 'rest_export_nodes',
    description: 'Export nodes as images via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        nodeIds: { type: 'array', items: { type: 'string' } },
        format: { type: 'string', enum: ['png', 'jpg', 'svg', 'pdf'] },
        scale: { type: 'number' },
        accessToken: { type: 'string' },
      },
      required: ['fileKey', 'nodeIds', 'accessToken'],
    },
  },
  {
    name: 'rest_batch_export',
    description: 'Batch export nodes from multiple files via REST API.',
    inputSchema: {
      type: 'object',
      properties: {
        exports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fileKey: { type: 'string' },
              nodeId: { type: 'string' },
              format: { type: 'string' },
              scale: { type: 'number' },
            },
          },
        },
        accessToken: { type: 'string' },
      },
      required: ['exports', 'accessToken'],
    },
  },
  {
    name: 'rest_download_image',
    description: 'Download image from URL (for exported assets).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
  },
  {
    name: 'rest_copy_component_to_local',
    description: 'Copy component from another file via REST API (export SVG).',
    inputSchema: {
      type: 'object',
      properties: {
        componentKey: { type: 'string' },
        accessToken: { type: 'string' },
      },
      required: ['componentKey', 'accessToken'],
    },
  },
  {
    name: 'rest_compare_components',
    description: 'Compare components between two files.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceFileKey: { type: 'string' },
        targetFileKey: { type: 'string' },
        accessToken: { type: 'string' },
      },
      required: ['sourceFileKey', 'targetFileKey', 'accessToken'],
    },
  },
  {
    name: 'rest_get_rate_limit',
    description: 'Check REST API rate limit status.',
    inputSchema: {
      type: 'object',
    },
  },

  // ===== System & Performance =====
  {
    name: 'get_performance_report',
    description: 'Get performance report for all operations.',
    inputSchema: {
      type: 'object',
    },
  },
  {
    name: 'cancel_operation',
    description: 'Cancel a running operation by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'get_active_operations',
    description: 'Get list of currently active operations.',
    inputSchema: {
      type: 'object',
    },
  },
];

// Main Server Class
class SuperchargedMCPServer {
  private server: Server;
  private figmaConnection: FigmaPluginConnection;
  private progressManager: ProgressManager;
  private batchExecutor: EnhancedBatchExecutor;
  private restBridge: FigmaRESTBridge | null = null;
  private httpServer: HttpServer | null = null;
  private readonly connectionStatePath = path.join(os.tmpdir(), 'supercharged-figma-last-connection.json');

  constructor() {
    this.figmaConnection = new FigmaPluginConnection();
    this.progressManager = new ProgressManager();
    this.batchExecutor = new EnhancedBatchExecutor(this.progressManager);
    this.server = new Server(
      {
        name: 'supercharged-figma-mcp',
        version: MCP_SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupProgressHandlers();
  }

  private setupProgressHandlers() {
    // 转发进度事件到 Figma Plugin
    this.progressManager.on('progress', (update) => {
      if (!this.figmaConnection.isConnected()) return;
      this.figmaConnection.sendNotification({
        type: 'progress_update',
        id: uuidv4(),
        payload: update,
      });
    });

    this.progressManager.on('complete', (data) => {
      if (!this.figmaConnection.isConnected()) return;
      this.figmaConnection.sendNotification({
        type: 'progress_complete',
        id: uuidv4(),
        payload: data,
      });
    });
  }

  private classifyToolError(toolName: string, errorMessage: string): {
    code: string;
    retryable: boolean;
    hint: string;
  } {
    const msg = errorMessage.toLowerCase();
    const tool = toolName.toLowerCase();

    if (msg.includes('not connected to figma') || msg.includes('channel code')) {
      return {
        code: 'E_NOT_CONNECTED',
        retryable: true,
        hint: 'Reconnect with connect_to_relay and ensure plugin status is connected.',
      };
    }

    if (msg.includes('too many pending requests') || msg.includes('timeout') || msg.includes('timed out')) {
      return {
        code: 'E_TIMEOUT',
        retryable: true,
        hint: 'Reduce payload size or retry after clearing queue / reconnecting.',
      };
    }

    if (msg.includes('invalid') || msg.includes('required') || msg.includes('unknown tool') || msg.includes('validation')) {
      return {
        code: 'E_INVALID_INPUT',
        retryable: false,
        hint: 'Check tool schema and required fields; do not pass unsupported keys.',
      };
    }

    if (tool.includes('interaction') && (msg.includes('cross') || msg.includes('page') || msg.includes('reaction'))) {
      return {
        code: 'E_CROSS_PAGE_INTERACTION',
        retryable: false,
        hint: 'Source and destination must be valid nodes on an active accessible page.',
      };
    }

    if (msg.includes('node not found') || msg.includes('missing')) {
      return {
        code: 'E_NODE_NOT_FOUND',
        retryable: false,
        hint: 'Verify node IDs still exist and are on loaded pages.',
      };
    }

    if (tool.startsWith('rest_')) {
      return {
        code: 'E_REST_API',
        retryable: true,
        hint: 'Check access token, file/team IDs, and REST rate limits.',
      };
    }

    return {
      code: 'E_TOOL_EXECUTION',
      retryable: false,
      hint: 'Inspect plugin logs and retry with smaller, deterministic inputs.',
    };
  }

  private formatToolError(toolName: string, errorMessage: string): string {
    const classified = this.classifyToolError(toolName, errorMessage);
    return JSON.stringify(
      {
        code: classified.code,
        message: errorMessage,
        tool: toolName,
        retryable: classified.retryable,
        hint: classified.hint,
      },
      null,
      2
    );
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Best-effort auto reconnect for non-system tools, useful when MCP runtime is recycled.
      if (!name.startsWith('rest_') && name !== 'connect_to_relay' && name !== 'get_connection_status') {
        await this.tryRestoreConnection();
      }

      // Handle REST API bridge tools
      if (name.startsWith('rest_')) {
        return this.handleRESTTool(name, args);
      }

      // Handle system tools
      if (name === 'connect_to_relay') {
        const channelCode = (args as any)?.channelCode;
        const relayUrlArg = (args as any)?.relayUrl;
        const targetRelayUrl = typeof relayUrlArg === 'string' && relayUrlArg.trim()
          ? relayUrlArg.trim()
          : this.relayUrl;
        const connected = this.figmaConnection.isConnected();
        const figmaConnected = this.figmaConnection.isFigmaConnected();
        const currentChannel = this.figmaConnection.getChannelId();
        
        if (connected && figmaConnected && currentChannel === channelCode && targetRelayUrl === this.relayUrl) {
          return {
            content: [{ type: 'text', text: '✅ 已连接到 Figma' }],
          };
        }
        
        if (!channelCode) {
          return {
            content: [{ 
              type: 'text', 
              text: `❌ 需要提供 Channel Code（禁止猜测）\n\n请先在 Figma 插件中获取真实 Channel Code，然后调用：\nconnect_to_relay {"relayUrl":"ws://127.0.0.1:8888","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}` 
            }],
          };
        }
        
        try {
          await this.connectToRelay(channelCode, targetRelayUrl);
          await this.persistConnectionState(targetRelayUrl, channelCode);
          return {
            content: [{ 
              type: 'text', 
              text: `✅ 成功连接到 Figma！\nRelay: ${targetRelayUrl}\nChannel: ${channelCode}\n现在可以使用所有 Figma 工具了。` 
            }],
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: `❌ 连接失败: ${error.message}\n\n请检查:\n1. Figma 插件是否已连接 Relay Server\n2. Channel Code 是否正确\n3. Relay Server 是否运行中` 
            }],
            isError: true,
          };
        }
      }
      if (name === 'get_connection_status') {
        await this.tryRestoreConnection();
        const connected = this.figmaConnection.isConnected();
        const figmaConnected = this.figmaConnection.isFigmaConnected();
        const channel = this.figmaConnection.getChannelId();
        const relayUrl = this.relayUrl;
        const ready = connected && figmaConnected;
        const includeDebugRaw = (args as any)?.includeDebugEvents;
        const includeDebugEvents = includeDebugRaw === true || includeDebugRaw === 'true' || includeDebugRaw === 1 || includeDebugRaw === '1';
        const debugLimitRaw = Number((args as any)?.debugLimit ?? 20);
        const debugLimit = Number.isFinite(debugLimitRaw)
          ? Math.max(1, Math.min(200, Math.floor(debugLimitRaw)))
          : 20;
        const allEvents = this.figmaConnection.getDebugEvents();
        const debugEvents = includeDebugEvents
          ? allEvents.slice(Math.max(0, allEvents.length - debugLimit))
          : [];
        const nextAction = ready
          ? 'Connected. You can run other MCP tools now.'
          : 'Not connected. Ask user to open Figma plugin, get Channel Code, then run connect_to_relay.';
        const connectTemplate = `connect_to_relay {"relayUrl":"${relayUrl}","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}`;

        const statusPayload: Record<string, any> = {
          ready,
          connectedToRelay: connected,
          figmaHandshakeComplete: figmaConnected,
          relayUrl,
          channelCode: channel,
          processId: process.pid,
          debugEventCount: allEvents.length,
          nextAction,
          connectTemplate,
        };
        if (includeDebugEvents) {
          statusPayload.debugEvents = debugEvents;
          statusPayload.debugLimit = debugLimit;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(statusPayload, null, 2),
          }],
        };
      }
      if (name === 'get_performance_report') {
        return this.handlePerformanceReport();
      }
      if (name === 'get_active_operations') {
        return this.handleActiveOperations();
      }
      if (name === 'cancel_operation') {
        const opId = (args as any)?.operationId;
        if (!opId) throw new Error('operationId required');
        return this.handleCancelOperation(opId);
      }

      // Handle Figma Plugin tools
      if (!this.figmaConnection.isConnected()) {
        throw new Error(
          'Not connected to Figma. First ask user to open Figma plugin and get Channel Code, then call: ' +
          'connect_to_relay {"relayUrl":"ws://127.0.0.1:8888","channelCode":"<CHANNEL_FROM_FIGMA_PLUGIN>"}'
        );
      }

      const messageId = uuidv4();
      const pendingCount = this.figmaConnection.getPendingRequestCount();
      if (pendingCount > 200) {
        throw new Error(`Too many pending requests (${pendingCount}). Reconnect relay/plugin and retry.`);
      }

      // 对于批量操作，使用增强的执行器
      if (this.isBatchOperation(name)) {
        return this.handleBatchOperation(name, args, messageId);
      }

      try {
        const result = await this.figmaConnection.send({
          type: name,
          id: messageId,
          payload: args,
        }, 120000);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(this.formatToolError(name, errorMessage));
      }
    });
  }

  private isBatchOperation(name: string): boolean {
    const batchOps = [
      'batch_create', 'batch_modify', 'batch_clone', 'batch_rename', 'batch_delete',
      'batch_edit_across_pages', 'smart_select', 'find_similar', 'analyze_duplicates',
      'frame_to_components', 'cross_page_copy', 'cross_page_move', 'arrange_nodes',
    ];
    return batchOps.includes(name);
  }

  private async handleBatchOperation(name: string, args: any, messageId: string): Promise<any> {
    // 通知开始操作
    const operationId = uuidv4();
    this.progressManager.startOperation(
      operationId,
      name,
      this.estimateItemCount(name, args),
      this.getOperationStages(name)
    );

    try {
      const result = await this.figmaConnection.send({
        type: name,
        id: messageId,
        payload: { ...args, operationId },
      }, 300000);

      this.progressManager.completeOperation(operationId, result);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      this.progressManager.cancelOperation(operationId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(this.formatToolError(name, errorMessage));
    }
  }

  private estimateItemCount(name: string, args: any): number {
    switch (name) {
      case 'batch_create':
      case 'batch_modify':
        return args.operations?.length || 1;
      case 'batch_clone':
        return args.count || 1;
      case 'batch_rename':
      case 'batch_delete':
        return args.nodeIds?.length || 1;
      case 'smart_select':
        return args.limit || 100;
      default:
        return 100;
    }
  }

  private getOperationStages(name: string): Array<{ name: string; weight: number }> {
    switch (name) {
      case 'frame_to_components':
        return [
          { name: '分析结构', weight: 0.2 },
          { name: '分组处理', weight: 0.3 },
          { name: '创建组件', weight: 0.4 },
          { name: '整理输出', weight: 0.1 },
        ];
      case 'analyze_duplicates':
        return [
          { name: '扫描节点', weight: 0.4 },
          { name: '相似度计算', weight: 0.5 },
          { name: '生成报告', weight: 0.1 },
        ];
      default:
        return [
          { name: '准备', weight: 0.1 },
          { name: '处理', weight: 0.8 },
          { name: '完成', weight: 0.1 },
        ];
    }
  }

  private async handleRESTTool(name: string, args: any): Promise<any> {
    // 初始化或复用 REST Bridge
    if (!this.restBridge && args.accessToken) {
      this.restBridge = new FigmaRESTBridge({ accessToken: args.accessToken });
    }

    if (!this.restBridge) {
      throw new Error('REST API access token required');
    }

    let result: any;

    try {
      switch (name) {
        case 'rest_get_file':
          result = await this.restBridge.getFile(args.fileKey, {
            version: args.version,
            depth: args.depth,
          });
          break;
        case 'rest_get_file_nodes':
          result = await this.restBridge.getFileNodes(args.fileKey, args.nodeIds);
          break;
        case 'rest_get_team_components':
          result = await this.restBridge.getTeamComponents(args.teamId);
          break;
        case 'rest_get_file_components':
          result = await this.restBridge.getFileComponents(args.fileKey);
          break;
        case 'rest_get_team_styles':
          result = await this.restBridge.getTeamStyles(args.teamId);
          break;
        case 'rest_export_nodes':
          result = await this.restBridge.getImages(args.fileKey, args.nodeIds, {
            format: args.format,
            scale: args.scale,
          });
          break;
        case 'rest_batch_export':
          result = await this.restBridge.batchExport(args.exports);
          break;
        case 'rest_download_image':
          const buffer = await this.restBridge.downloadImage(args.url);
          result = { size: buffer.length, base64: buffer.toString('base64').slice(0, 100) + '...' };
          break;
        case 'rest_copy_component_to_local':
          result = await this.restBridge.copyComponentToLocal(args.componentKey);
          break;
        case 'rest_compare_components':
          const sync = new CrossProjectSync(this.restBridge);
          result = await sync.compareComponents(args.sourceFileKey, args.targetFileKey);
          break;
        case 'rest_get_rate_limit':
          result = this.restBridge.getRateLimitStatus();
          break;
        default:
          throw new Error(`Unknown REST tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(this.formatToolError(name, `REST API error: ${errorMessage}`));
    }
  }

  private async handlePerformanceReport(): Promise<any> {
    const report = this.batchExecutor.getPerformanceReport();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  }

  private async handleActiveOperations(): Promise<any> {
    const active = this.progressManager.getActiveOperations();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ activeOperations: active }, null, 2),
        },
      ],
    };
  }

  private async handleCancelOperation(operationId: string): Promise<any> {
    this.progressManager.cancelOperation(operationId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ cancelled: true, operationId }, null, 2),
        },
      ],
    };
  }

  async start(relayUrl?: string, channelId?: string) {
    // Connect to relay server
    if (relayUrl && channelId) {
      await this.figmaConnection.connect(relayUrl, channelId);
    }

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.log(chalk.green('✓ Supercharged Figma MCP Server running'));
    console.log(chalk.gray(`  Tools available: ${TOOLS.length}`));
    console.log(chalk.gray(`  Features: Progress Tracking, Performance Optimization, REST API Bridge`));
  }

  async startMCPOnly(relayUrl: string): Promise<void> {
    this.relayUrl = relayUrl;
    
    // Start MCP server with stdio transport (without Figma connection)
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.log(chalk.green('✓ MCP Server started'));
    console.log(chalk.gray(`  Tools available: ${TOOLS.length}`));
    console.log(chalk.gray(`  Use 'connect_to_relay' tool to connect to Figma`));
  }

  async startMCPOverHttp(relayUrl: string, host: string, port: number, path: string): Promise<void> {
    this.relayUrl = relayUrl;

    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await this.server.connect(httpTransport);

    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Basic CORS support for browser-based MCP clients.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,Mcp-Session-Id,Last-Event-ID');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
      if (requestUrl.pathname === '/healthz') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, relayUrl: this.relayUrl }));
        return;
      }

      if (requestUrl.pathname !== path) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          error: 'Not Found',
          expectedPath: path,
        }));
        return;
      }

      try {
        await httpTransport.handleRequest(req, res);
      } catch (error: any) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: error?.message || 'Internal error' }));
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(port, host, () => {
        this.httpServer!.off('error', reject);
        resolve();
      });
    });

    const displayHost = host.includes(':') ? `[${host}]` : host;
    console.log(chalk.green('✓ MCP Server started (HTTP Streamable)'));
    console.log(chalk.gray(`  Endpoint: http://${displayHost}:${port}${path}`));
    console.log(chalk.gray(`  Health:   http://${displayHost}:${port}/healthz`));
    console.log(chalk.gray(`  Use 'connect_to_relay' tool to connect to Figma`));
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;
    const server = this.httpServer;
    this.httpServer = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private relayUrl: string = 'ws://127.0.0.1:8888';

  async connectToRelay(channelCode: string, relayUrl?: string): Promise<void> {
    const targetRelayUrl = relayUrl && relayUrl.trim() ? relayUrl.trim() : this.relayUrl;
    this.relayUrl = targetRelayUrl;
    await this.figmaConnection.connect(targetRelayUrl, channelCode);
  }

  private async persistConnectionState(relayUrl: string, channelCode: string): Promise<void> {
    try {
      await fs.writeFile(
        this.connectionStatePath,
        JSON.stringify({
          relayUrl,
          channelCode,
          savedAt: new Date().toISOString(),
        }),
        'utf8'
      );
      console.log(chalk.gray(`[MCP pid=${process.pid}] persisted connection state -> ${this.connectionStatePath}`));
    } catch {
      // Best effort only.
    }
  }

  private async tryRestoreConnection(): Promise<void> {
    if (this.figmaConnection.isFigmaConnected()) return;

    try {
      const raw = await fs.readFile(this.connectionStatePath, 'utf8');
      const state = JSON.parse(raw) as { relayUrl?: string; channelCode?: string };
      const relayUrl = typeof state?.relayUrl === 'string' ? state.relayUrl : this.relayUrl;
      const channelCode = typeof state?.channelCode === 'string' ? state.channelCode : '';
      if (!channelCode) return;
      console.log(chalk.gray(`[MCP pid=${process.pid}] restoring connection from state file: relay=${relayUrl} channel=${channelCode}`));
      await this.connectToRelay(channelCode, relayUrl);
      console.log(chalk.green(`[MCP pid=${process.pid}] restore connection success`));
    } catch {
      // Ignore restore failures; caller will surface normal connect error if needed.
    }
  }
}

type RelayMode = 'local' | 'remote';
type McpTransportMode = 'stdio' | 'http';

interface StartupConfig {
  relayMode: RelayMode;
  mcpTransport: McpTransportMode;
  mcpHost: string;
  mcpPort: number;
  mcpPath: string;
  remoteRelayUrl?: string;
  relayHost: string;
  relayPort: number;
  relayPath: string;
  relayUrl: string;
  transportExplicit: boolean;
  showHelp: boolean;
}

function parseStartupConfig(argv: string[]): StartupConfig {
  const args = argv.slice(2);
  const showHelp = args.includes('--help') || args.includes('-h');
  const readOption = (names: string[]): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      for (const name of names) {
        if (args[i] === name) {
          const next = args[i + 1];
          if (next && !next.startsWith('--')) return next;
        }
        if (args[i].startsWith(`${name}=`)) {
          return args[i].slice(name.length + 1);
        }
      }
    }
    return undefined;
  };
  const hasFlag = (name: string) => args.includes(name);

  const relayUrlFromArg = readOption(['--relay-server', '--relay', '--relay-url']);
  const remoteRelayUrl = readOption(['--remote']);

  const relayModeRaw = readOption(['--relay-mode']) || process.env.FIGMA_RELAY_MODE;
  const hasLocalFlag = hasFlag('--local');
  const hasRemoteFlag = hasFlag('--remote') || !!remoteRelayUrl;
  const relayMode: RelayMode = hasRemoteFlag || relayModeRaw === 'remote' ? 'remote' : hasLocalFlag || relayModeRaw === 'local' ? 'local' : 'local';

  const transportExplicit = !!readOption(['--transport']) || !!process.env.MCP_TRANSPORT;
  const hasHostOrPort = hasFlag('--host') || hasFlag('--port') || !!readOption(['--host']) || !!readOption(['--port']);
  const mcpTransportRaw = readOption(['--transport']) || process.env.MCP_TRANSPORT || (hasHostOrPort ? 'http' : 'stdio');
  const mcpTransport: McpTransportMode = mcpTransportRaw === 'http' ? 'http' : 'stdio';

  const mcpHost = readOption(['--host'])
    || process.env.MCP_HOST
    || '127.0.0.1';
  const mcpPortRaw = readOption(['--port'])
    || process.env.MCP_PORT
    || '3333';
  const mcpPort = Number(mcpPortRaw);
  if (!Number.isInteger(mcpPort) || mcpPort <= 0 || mcpPort > 65535) {
    throw new Error(`Invalid MCP port: ${mcpPortRaw}`);
  }
  const mcpPath = readOption(['--mcp-path'])
    || process.env.MCP_HTTP_PATH
    || '/mcp';

  const relayHost = readOption(['--relay-host'])
    || process.env.FIGMA_RELAY_HOST
    || '127.0.0.1';

  const relayPortRaw = readOption(['--relay-port'])
    || process.env.FIGMA_RELAY_PORT
    || '8888';
  const relayPort = Number(relayPortRaw);
  if (!Number.isInteger(relayPort) || relayPort <= 0 || relayPort > 65535) {
    throw new Error(`Invalid relay port: ${relayPortRaw}`);
  }
  const relayPathRaw = readOption(['--relay-path'])
    || process.env.FIGMA_RELAY_PATH
    || '/';
  const relayPath = relayPathRaw === '/' ? '/' : (relayPathRaw.startsWith('/') ? relayPathRaw : `/${relayPathRaw}`);

  let relayUrl = remoteRelayUrl || relayUrlFromArg || process.env.FIGMA_RELAY_URL;
  if (!relayUrl) {
    const encodedHost = relayHost.includes(':') ? `[${relayHost}]` : relayHost;
    const normalizedPath = relayPath === '/' ? '' : relayPath.replace(/\/+$/, '');
    relayUrl = `ws://${encodedHost}:${relayPort}${normalizedPath}`;
  }

  return {
    relayMode,
    mcpTransport,
    mcpHost,
    mcpPort,
    mcpPath,
    remoteRelayUrl,
    relayHost,
    relayPort,
    relayPath,
    relayUrl,
    transportExplicit,
    showHelp,
  };
}

function printHelp() {
  console.log(`
Supercharged Figma MCP

Modes:
  --local                         Start local embedded relay (default)
  --remote <ws(s)://...>          Use remote relay endpoint

MCP Transport:
  --transport stdio|http          MCP transport (default: stdio; auto http when --host/--port present)
  --host <host>                   MCP HTTP bind host (http mode)
  --port <port>                   MCP HTTP bind port (http mode)
  --mcp-path </path>              MCP HTTP path (default: /mcp)

Relay (local mode):
  --relay-host <host>             Embedded relay bind host (default: 127.0.0.1)
  --relay-port <port>             Embedded relay bind port (default: 8888)
  --relay-path </path>            Embedded relay ws path (default: /)

Compatibility flags:
  --relay-mode local|remote
  --relay-url <ws(s)://...>
  --relay-server <ws(s)://...>
  --relay <ws(s)://...>
`);
}

// CLI Entry
async function main() {
  const config = parseStartupConfig(process.argv);
  if (config.showHelp) {
    printHelp();
    return;
  }
  if (config.relayMode === 'remote' && !config.remoteRelayUrl && !process.env.FIGMA_RELAY_URL) {
    throw new Error('Remote mode requires --remote <ws(s)://...> (or FIGMA_RELAY_URL).');
  }

  console.log(chalk.blue('\n╔════════════════════════════════════════════════╗'));
  console.log(chalk.blue('║   Supercharged Figma MCP Server                ║'));
  console.log(chalk.blue('╚════════════════════════════════════════════════╝\n'));
  console.log(chalk.gray(`Relay mode: ${config.relayMode}`));
  console.log(chalk.gray(`MCP transport: ${config.mcpTransport}`));
  if (!config.transportExplicit && config.mcpTransport === 'http') {
    console.log(chalk.gray('Transport auto-selected to HTTP because --host/--port was provided.'));
  }
  console.log(chalk.gray(`Relay URL: ${config.relayUrl}`));
  if (config.mcpTransport === 'http') {
    const displayHost = config.mcpHost.includes(':') ? `[${config.mcpHost}]` : config.mcpHost;
    console.log(chalk.gray(`MCP endpoint: http://${displayHost}:${config.mcpPort}${config.mcpPath}`));
  }
  console.log(chalk.gray('Status: Waiting for connection...\n'));

  let embeddedRelay: EmbeddedRelay | null = null;
  let instanceManager: InstanceManager | null = null;
  let shuttingDown = false;

  if (config.relayMode === 'local') {
    instanceManager = new InstanceManager(config.relayHost, config.relayPort);
    const lockInfo = await instanceManager.acquire();

    if (!lockInfo.acquired) {
      console.log(
        chalk.yellow(
          `! Relay lock already held by PID ${lockInfo.ownerPid ?? 'unknown'}. Reusing existing relay endpoint.`
        )
      );
    } else {
      embeddedRelay = new EmbeddedRelay({
        host: config.relayHost,
        port: config.relayPort,
        path: config.relayPath,
      });

      try {
        await embeddedRelay.start();
      } catch (error: any) {
        await instanceManager.release();
        instanceManager = null;
        embeddedRelay = null;
        console.log(
          chalk.yellow(
            `! Failed to start embedded relay (${error?.message || String(error)}). Falling back to remote relay mode.`
          )
        );
      }
    }
  }

  const server = new SuperchargedMCPServer();
  if (config.mcpTransport === 'http') {
    await server.startMCPOverHttp(config.relayUrl, config.mcpHost, config.mcpPort, config.mcpPath);
  } else {
    await server.startMCPOnly(config.relayUrl);
  }

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.gray(`\nReceived ${signal}, shutting down...`));

    try {
      await server.stop();
      if (embeddedRelay) {
        await embeddedRelay.stop();
      }
      if (instanceManager) {
        await instanceManager.release();
      }
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch(console.error);
