import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface InstanceLockInfo {
  acquired: boolean;
  lockPath: string;
  ownerPid?: number;
}

interface LockPayload {
  pid: number;
  host: string;
  port: number;
  createdAt: string;
}

export class InstanceManager {
  private readonly host: string;
  private readonly port: number;
  private readonly lockPath: string;
  private ownsLock = false;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    const safeHost = host.replace(/[^a-zA-Z0-9_.-]/g, '_');
    this.lockPath = path.join(
      os.tmpdir(),
      `supercharged-figma-relay-${safeHost}-${port}.lock.json`
    );
  }

  async acquire(): Promise<InstanceLockInfo> {
    const payload: LockPayload = {
      pid: process.pid,
      host: this.host,
      port: this.port,
      createdAt: new Date().toISOString(),
    };

    try {
      await fs.writeFile(this.lockPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
      this.ownsLock = true;
      return { acquired: true, lockPath: this.lockPath };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }

    const existing = await this.readExistingPid();
    if (existing && this.isProcessAlive(existing)) {
      return { acquired: false, lockPath: this.lockPath, ownerPid: existing };
    }

    // Stale lock: remove and retry once.
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // ignore race
    }

    try {
      await fs.writeFile(this.lockPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
      this.ownsLock = true;
      return { acquired: true, lockPath: this.lockPath };
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        const ownerPid = await this.readExistingPid();
        return { acquired: false, lockPath: this.lockPath, ownerPid: ownerPid ?? undefined };
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (!this.ownsLock) return;
    this.ownsLock = false;
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // ignore
    }
  }

  private async readExistingPid(): Promise<number | null> {
    try {
      const raw = await fs.readFile(this.lockPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LockPayload>;
      if (typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)) {
        return parsed.pid;
      }
      return null;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error?.code === 'EPERM';
    }
  }
}

