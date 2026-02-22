#!/usr/bin/env node
/**
 * WebSocket Relay Server for Figma MCP
 * Allows multiple MCP clients to share one Figma connection via channel ID
 * 
 * Usage:
 *   node relay-server.js
 *   node relay-server.js 8080
 *   node relay-server.js --port 8080 --host 127.0.0.1
 *   node relay-server.js --port=8080 --host=::1
 */

import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';

function parseArgs(argv) {
  let host = process.env.RELAY_HOST || '127.0.0.1';
  let port = Number(process.env.RELAY_PORT) || 8080;
  let showHelp = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      showHelp = true;
      continue;
    }

    if (/^\d+$/.test(arg)) {
      port = Number(arg);
      continue;
    }

    if (arg === '--port' || arg === '-p') {
      const next = argv[i + 1];
      if (!next || !/^\d+$/.test(next)) throw new Error('Invalid value for --port');
      port = Number(next);
      i++;
      continue;
    }

    if (arg.startsWith('--port=')) {
      const value = arg.split('=')[1];
      if (!/^\d+$/.test(value)) throw new Error('Invalid value for --port');
      port = Number(value);
      continue;
    }

    if (arg === '--host') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --host');
      host = next;
      i++;
      continue;
    }

    if (arg.startsWith('--host=')) {
      host = arg.split('=')[1];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return { host, port, showHelp };
}

function printHelp() {
  console.log('Figma MCP Relay Server');
  console.log('');
  console.log('Usage:');
  console.log('  node relay-server.js');
  console.log('  node relay-server.js 8080');
  console.log('  node relay-server.js --port 8080 --host 127.0.0.1');
  console.log('  node relay-server.js --port=8080 --host=::1');
  console.log('');
  console.log('Options:');
  console.log('  -p, --port <number>   Listen port (default: 8080)');
  console.log('      --host <address>  Listen host/address (default: 127.0.0.1)');
  console.log('  -h, --help            Show this help');
}

let config;
try {
  config = parseArgs(process.argv);
} catch (err) {
  console.error(chalk.red(`Argument error: ${err.message}`));
  printHelp();
  process.exit(1);
}

if (config.showHelp) {
  printHelp();
  process.exit(0);
}

const { host: HOST, port: PORT } = config;

// Channel management: channelId -> { figma: WebSocket, clients: Set<WebSocket> }
const channels = new Map();

function generateChannelId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getOrCreateChannel(channelId) {
  if (!channels.has(channelId)) {
    channels.set(channelId, {
      figma: null,
      clients: new Set(),
      createdAt: Date.now()
    });
  }
  return channels.get(channelId);
}

function cleanupChannel(channelId) {
  const channel = channels.get(channelId);
  if (!channel) return;
  
  if (!channel.figma && channel.clients.size === 0) {
    channels.delete(channelId);
    console.log(chalk.gray(`Channel ${channelId} cleaned up`));
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('listening', () => {
  console.log(chalk.green(`✓ Figma MCP Relay Server running`));
  const displayHost = HOST.includes(':') ? `[${HOST}]` : HOST;
  console.log(chalk.blue(`  WebSocket: ws://${displayHost}:${PORT}`));
  console.log(chalk.gray(`  Channels: ${channels.size} active`));
});

wss.on('connection', (ws, req) => {
  const baseHost = HOST.includes(':') ? `[${HOST}]` : HOST;
  const url = new URL(req.url, `http://${baseHost}:${PORT}`);
  let channelId = url.searchParams.get('channel');
  const clientType = url.searchParams.get('type') || 'unknown'; // 'figma' or 'client'
  
  // Auto-generate channel for Figma if not provided
  if (clientType === 'figma' && !channelId) {
    channelId = generateChannelId();
    console.log(chalk.blue(`Auto-generated channel for Figma: ${channelId}`));
  }
  
  if (!channelId) {
    ws.close(4000, 'Channel ID required');
    return;
  }
  
  const channel = getOrCreateChannel(channelId);
  
  console.log(chalk.blue(`[${channelId}] ${clientType} connected`));
  
  if (clientType === 'figma') {
    // Figma plugin connection
    if (channel.figma) {
      console.log(chalk.yellow(`[${channelId}] Figma reconnected, closing old connection`));
      channel.figma.close();
    }
    channel.figma = ws;
    
    // Send channel info to Figma
    ws.send(JSON.stringify({
      type: 'system',
      event: 'connected',
      channel: channelId
    }));
    
    // Notify all clients that Figma is connected
    channel.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'system',
          event: 'figma_connected',
          channel: channelId
        }));
      }
    });
    
    ws.on('message', (data) => {
      // Broadcast Figma messages to all MCP clients
      channel.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    });
    
    ws.on('close', () => {
      // Ignore stale close events from older Figma sockets after reconnect.
      if (channel.figma !== ws) {
        return;
      }

      console.log(chalk.yellow(`[${channelId}] Figma disconnected`));
      channel.figma = null;
      
      // Notify clients
      channel.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'system',
            event: 'figma_disconnected',
            channel: channelId
          }));
        }
      });
      
      cleanupChannel(channelId);
    });
    
  } else {
    // MCP client connection
    channel.clients.add(ws);
    
    // Send channel info to client
    ws.send(JSON.stringify({
      type: 'system',
      event: 'connected',
      channel: channelId,
      figmaConnected: !!channel.figma
    }));
    
    ws.on('message', (data) => {
      // Forward client messages to Figma
      if (channel.figma && channel.figma.readyState === WebSocket.OPEN) {
        channel.figma.send(data);
      } else {
        ws.send(JSON.stringify({
          type: 'system',
          event: 'error',
          error: 'Figma not connected'
        }));
      }
    });
    
    ws.on('close', () => {
      console.log(chalk.gray(`[${channelId}] Client disconnected`));
      channel.clients.delete(ws);
      cleanupChannel(channelId);
    });
  }
  
  ws.on('error', (err) => {
    console.error(chalk.red(`[${channelId}] WebSocket error:`), err.message);
    if (clientType === 'figma' && channel.figma === ws) {
      channel.figma = null;
      cleanupChannel(channelId);
    }
    if (clientType !== 'figma') {
      channel.clients.delete(ws);
      cleanupChannel(channelId);
    }
  });
});

// Health check endpoint
wss.on('error', (err) => {
  console.error(chalk.red('Relay server error:'), err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) {
    console.log(chalk.red('Force exiting...'));
    process.exit(1);
    return;
  }
  shuttingDown = true;

  console.log(chalk.yellow(`\nReceived ${signal}, shutting down relay server...`));

  for (const ws of wss.clients) {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
  }

  const timeout = setTimeout(() => {
    console.log(chalk.red('Shutdown timed out, forcing exit.'));
    process.exit(1);
  }, 3000);
  timeout.unref();

  wss.close(() => {
    clearTimeout(timeout);
    console.log(chalk.green('Relay server stopped'));
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
