import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { EmbeddedRelay } from '../../runtime/embedded-relay.js';

const TEST_HOST = '127.0.0.1';

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for message after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('message', (data) => {
      clearTimeout(timeout);
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      resolve(JSON.parse(raw));
    });

    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for open after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });

    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function createTestWebSocket(url: string): WebSocket {
  const ws = new WebSocket(url);
  // Prevent unhandled "error" events from crashing node:test worker process.
  ws.on('error', () => {});
  return ws;
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for close after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('close', (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString('utf8') });
    });

    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function closeSocketGracefully(ws: WebSocket | null, timeoutMs = 2000): Promise<void> {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve();
    }, timeoutMs);

    ws.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CLOSING) {
        // wait for close event
      }
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function startRelayOrSkip(t: { skip: (message?: string) => void }): Promise<EmbeddedRelay | null> {
  const relay = new EmbeddedRelay({ host: TEST_HOST, port: 0 });
  try {
    await relay.start();
    return relay;
  } catch (err: any) {
    if (String(err?.message || '').includes('EPERM')) {
      t.skip('Skipping relay socket tests in restricted sandbox (EPERM on listen)');
      return null;
    }
    throw err;
  }
}

describe('Relay Protocol Compatibility', () => {
  let relay: EmbeddedRelay | null = null;
  let figmaWs: WebSocket | null = null;
  let clientWs: WebSocket | null = null;

  afterEach(async () => {
    await closeSocketGracefully(figmaWs);
    await closeSocketGracefully(clientWs);
    figmaWs = null;
    clientWs = null;
    if (relay) {
      await relay.stop();
      relay = null;
    }
  });

  it('keeps legacy flow: figma connects without channel and receives generated channel', async (t) => {
    relay = await startRelayOrSkip(t);
    if (!relay) return;
    const relayUrl = relay.getWebSocketUrl();

    figmaWs = createTestWebSocket(`${relayUrl}?type=figma`);
    const firstMsgPromise = waitForMessage(figmaWs);
    await waitForOpen(figmaWs);
    const firstMsg = await firstMsgPromise;

    assert.strictEqual(firstMsg.type, 'system');
    assert.strictEqual(firstMsg.event, 'connected');
    assert.ok(typeof firstMsg.channel === 'string' && firstMsg.channel.length > 0);
  });

  it('keeps legacy flow: MCP client binds to existing channel and gets figmaConnected=true', async (t) => {
    relay = await startRelayOrSkip(t);
    if (!relay) return;
    const relayUrl = relay.getWebSocketUrl();

    figmaWs = createTestWebSocket(`${relayUrl}?type=figma`);
    const figmaConnectedMsgPromise = waitForMessage(figmaWs);
    await waitForOpen(figmaWs);
    const figmaConnectedMsg = await figmaConnectedMsgPromise;
    const channel = figmaConnectedMsg.channel;

    clientWs = createTestWebSocket(`${relayUrl}?type=client&channel=${channel}`);
    const clientConnectedMsgPromise = waitForMessage(clientWs);
    await waitForOpen(clientWs);
    const clientConnectedMsg = await clientConnectedMsgPromise;

    assert.strictEqual(clientConnectedMsg.type, 'system');
    assert.strictEqual(clientConnectedMsg.event, 'connected');
    assert.strictEqual(clientConnectedMsg.channel, channel);
    assert.strictEqual(clientConnectedMsg.figmaConnected, true);
  });

  it('rejects client connection without channel (workflow requires channel bind)', async (t) => {
    relay = await startRelayOrSkip(t);
    if (!relay) return;
    const relayUrl = relay.getWebSocketUrl();

    clientWs = createTestWebSocket(`${relayUrl}?type=client`);
    const close = await waitForClose(clientWs);
    clientWs = null;

    assert.strictEqual(close.code, 4000);
  });

  it('notifies clients when figma disconnects', async (t) => {
    relay = await startRelayOrSkip(t);
    if (!relay) return;
    const relayUrl = relay.getWebSocketUrl();

    figmaWs = createTestWebSocket(`${relayUrl}?type=figma`);
    const figmaConnectedMsgPromise = waitForMessage(figmaWs);
    await waitForOpen(figmaWs);
    const figmaConnectedMsg = await figmaConnectedMsgPromise;
    const channel = figmaConnectedMsg.channel;

    clientWs = createTestWebSocket(`${relayUrl}?type=client&channel=${channel}`);
    const initialClientConnectedPromise = waitForMessage(clientWs);
    await waitForOpen(clientWs);
    await initialClientConnectedPromise; // initial connected

    const figmaDisconnectedPromise = waitForMessage(clientWs);
    figmaWs.close();
    const msg = await figmaDisconnectedPromise;

    assert.strictEqual(msg.type, 'system');
    assert.strictEqual(msg.event, 'figma_disconnected');
    assert.strictEqual(msg.channel, channel);
  });
});
