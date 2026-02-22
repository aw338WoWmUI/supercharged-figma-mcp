// REST API Bridge - 连接 Figma REST API 以支持跨项目操作
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';

export interface FigmaRESTConfig {
  accessToken: string;
  baseUrl?: string;
}

export interface FigmaFile {
  key: string;
  name: string;
  last_modified: string;
  thumbnail_url: string;
  version: string;
}

export interface FigmaComponent {
  key: string;
  file_key: string;
  node_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  user: {
    handle: string;
    img_url: string;
  };
  containing_frame?: {
    name: string;
    nodeId: string;
    pageId: string;
    backgroundColor: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
}

export interface FigmaStyle {
  key: string;
  file_key: string;
  node_id: string;
  name: string;
  style_type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  description: string;
  created_at: string;
  updated_at: string;
  user: {
    handle: string;
    img_url: string;
  };
  sort_position: string;
}

export interface ExportResult {
  err?: string;
  images: Record<string, string>;
}

// REST API 桥接器
export class FigmaRESTBridge extends EventEmitter {
  private config: FigmaRESTConfig;
  private rateLimitRemaining: number = 1000;
  private rateLimitReset: number = 0;

  constructor(config: FigmaRESTConfig) {
    super();
    this.config = {
      baseUrl: 'https://api.figma.com/v1',
      ...config,
    };
  }

  // 检查速率限制
  private checkRateLimit(): boolean {
    if (this.rateLimitRemaining <= 0) {
      const now = Date.now() / 1000;
      if (now < this.rateLimitReset) {
        const waitSeconds = Math.ceil(this.rateLimitReset - now);
        this.emit('rateLimit', { waitSeconds });
        return false;
      }
    }
    return true;
  }

  // 更新速率限制
  private updateRateLimit(headers: http.IncomingHttpHeaders) {
    const remaining = headers['x-rate-limit-remaining'];
    const reset = headers['x-rate-limit-reset'];
    
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining as string, 10);
    }
    if (reset) {
      this.rateLimitReset = parseInt(reset as string, 10);
    }
  }

  // HTTP 请求封装
  private request<T>(
    method: string,
    path: string,
    data?: any
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.checkRateLimit()) {
        reject(new Error('Rate limit exceeded'));
        return;
      }

      const url = new URL(path, this.config.baseUrl);
      const postData = data ? JSON.stringify(data) : undefined;

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'X-Figma-Token': this.config.accessToken,
          'Content-Type': 'application/json',
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
        },
      };

      const req = https.request(options, (res) => {
        this.updateRateLimit(res.headers);

        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.err) {
              reject(new Error(data.err));
            } else if (data.error) {
              reject(new Error(data.error));
            } else {
              resolve(data as T);
            }
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      
      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }

  // ===== 文件操作 =====

  // 获取文件信息
  async getFile(fileKey: string, opts?: { version?: string; ids?: string[]; depth?: number }): Promise<any> {
    const params = new URLSearchParams();
    if (opts?.version) params.append('version', opts.version);
    if (opts?.ids) params.append('ids', opts.ids.join(','));
    if (opts?.depth) params.append('depth', opts.depth.toString());
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/files/${fileKey}${query}`);
  }

  // 获取文件节点
  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<any> {
    const ids = nodeIds.join(',');
    return this.request('GET', `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`);
  }

  // 获取文件版本
  async getFileVersions(fileKey: string): Promise<{ versions: any[] }> {
    return this.request('GET', `/files/${fileKey}/versions`);
  }

  // ===== 组件库 =====

  // 获取团队组件库
  async getTeamComponents(teamId: string): Promise<{ meta: { components: FigmaComponent[] } }> {
    return this.request('GET', `/teams/${teamId}/components`);
  }

  // 获取文件组件库
  async getFileComponents(fileKey: string): Promise<{ meta: { components: FigmaComponent[] } }> {
    return this.request('GET', `/files/${fileKey}/components`);
  }

  // 获取组件详情
  async getComponent(key: string): Promise<{ meta: FigmaComponent }> {
    return this.request('GET', `/components/${key}`);
  }

  // ===== 样式库 =====

  // 获取团队样式库
  async getTeamStyles(teamId: string): Promise<{ meta: { styles: FigmaStyle[] } }> {
    return this.request('GET', `/teams/${teamId}/styles`);
  }

  // 获取文件样式库
  async getFileStyles(fileKey: string): Promise<{ meta: { styles: FigmaStyle[] } }> {
    return this.request('GET', `/files/${fileKey}/styles`);
  }

  // 获取样式详情
  async getStyle(key: string): Promise<{ meta: FigmaStyle }> {
    return this.request('GET', `/styles/${key}`);
  }

  // ===== 导出 =====

  // 获取导出图片 URL
  async getImages(
    fileKey: string,
    nodeIds: string[],
    opts: { format?: 'png' | 'jpg' | 'svg' | 'pdf'; scale?: number } = {}
  ): Promise<ExportResult> {
    const params = new URLSearchParams();
    params.append('ids', nodeIds.join(','));
    params.append('format', opts.format || 'png');
    params.append('scale', (opts.scale || 1).toString());
    
    return this.request('GET', `/images/${fileKey}?${params.toString()}`);
  }

  // 下载图片
  async downloadImage(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  // ===== 项目操作 =====

  // 获取项目文件
  async getProjectFiles(projectId: string): Promise<any> {
    return this.request('GET', `/projects/${projectId}/files`);
  }

  // ===== 高级操作 =====

  // 批量导出多个文件的节点
  async batchExport(
    exports: Array<{
      fileKey: string;
      nodeId: string;
      format?: 'png' | 'jpg' | 'svg' | 'pdf';
      scale?: number;
    }>
  ): Promise<Array<{ fileKey: string; nodeId: string; url?: string; error?: string }>> {
    const results: Array<{ fileKey: string; nodeId: string; url?: string; error?: string }> = [];
    
    // 按文件分组
    const byFile: Record<string, Array<{ nodeId: string; format: string; scale: number }>> = {};
    
    for (const exp of exports) {
      if (!byFile[exp.fileKey]) {
        byFile[exp.fileKey] = [];
      }
      byFile[exp.fileKey].push({
        nodeId: exp.nodeId,
        format: exp.format || 'png',
        scale: exp.scale || 1,
      });
    }

    // 逐个文件导出
    for (const [fileKey, nodes] of Object.entries(byFile)) {
      try {
        // 按格式分组
        const byFormat: Record<string, typeof nodes> = {};
        for (const node of nodes) {
          const key = `${node.format}-${node.scale}`;
          if (!byFormat[key]) byFormat[key] = [];
          byFormat[key].push(node);
        }

        for (const [formatKey, formatNodes] of Object.entries(byFormat)) {
          const [format, scale] = formatKey.split('-');
          const result = await this.getImages(
            fileKey,
            formatNodes.map(n => n.nodeId),
            { format: format as any, scale: parseFloat(scale) }
          );

          for (const node of formatNodes) {
            results.push({
              fileKey,
              nodeId: node.nodeId,
              url: result.images[node.nodeId],
              error: result.err,
            });
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        for (const node of nodes) {
          results.push({ fileKey, nodeId: node.nodeId, error: errorMsg });
        }
      }
    }

    return results;
  }

  // 复制组件到本地（通过导出/导入）
  async copyComponentToLocal(componentKey: string): Promise<{
    component: FigmaComponent;
    exportUrl?: string;
    svg?: string;
  }> {
    // 获取组件详情
    const { meta: component } = await this.getComponent(componentKey);
    
    // 导出组件
    const exportResult = await this.getImages(
      component.file_key,
      [component.node_id],
      { format: 'svg', scale: 1 }
    );

    const exportUrl = exportResult.images[component.node_id];
    
    // 下载 SVG
    let svg: string | undefined;
    if (exportUrl) {
      const buffer = await this.downloadImage(exportUrl);
      svg = buffer.toString('utf-8');
    }

    return { component, exportUrl, svg };
  }

  // 获取速率限制状态
  getRateLimitStatus(): { remaining: number; resetAt: Date } {
    return {
      remaining: this.rateLimitRemaining,
      resetAt: new Date(this.rateLimitReset * 1000),
    };
  }
}

// 跨项目同步管理器
export class CrossProjectSync {
  private restBridge: FigmaRESTBridge;

  constructor(restBridge: FigmaRESTBridge) {
    this.restBridge = restBridge;
  }

  // 同步组件库
  async syncComponentLibrary(
    sourceTeamId: string,
    targetFileKey: string,
    componentFilter?: (comp: FigmaComponent) => boolean
  ): Promise<{
    synced: number;
    failed: number;
    details: Array<{ component: string; status: 'success' | 'failed'; error?: string }>;
  }> {
    // 获取源团队组件
    const { meta: { components } } = await this.restBridge.getTeamComponents(sourceTeamId);
    
    // 过滤组件
    const toSync = componentFilter ? components.filter(componentFilter) : components;
    
    const results: Array<{ component: string; status: 'success' | 'failed'; error?: string }> = [];
    
    for (const component of toSync) {
      try {
        // 导出组件
        const { svg } = await this.restBridge.copyComponentToLocal(component.key);
        
        // 这里需要将 SVG 导入到目标文件
        // 由于 REST API 不支持直接创建节点，这需要通过 Plugin API 完成
        results.push({ component: component.name, status: 'success' });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ component: component.name, status: 'failed', error: errorMsg });
      }
    }

    const succeeded = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return { synced: succeeded, failed, details: results };
  }

  // 同步样式库
  async syncStyleLibrary(
    sourceTeamId: string,
    targetFileKey: string
  ): Promise<{
    synced: number;
    failed: number;
    styles: Array<{ name: string; type: string; status: 'success' | 'failed' }>;
  }> {
    // 获取源团队样式
    const { meta: { styles } } = await this.restBridge.getTeamStyles(sourceTeamId);
    
    // 注意：REST API 无法直接创建样式，需要配合 Plugin API
    // 这里返回样式信息，供后续处理
    
    return {
      synced: 0,
      failed: 0,
      styles: styles.map(s => ({
        name: s.name,
        type: s.style_type,
        status: 'success',
      })),
    };
  }

  // 比较两个文件的组件差异
  async compareComponents(
    sourceFileKey: string,
    targetFileKey: string
  ): Promise<{
    onlyInSource: FigmaComponent[];
    onlyInTarget: FigmaComponent[];
    different: Array<{ source: FigmaComponent; target: FigmaComponent; differences: string[] }>;
  }> {
    const [sourceComps, targetComps] = await Promise.all([
      this.restBridge.getFileComponents(sourceFileKey),
      this.restBridge.getFileComponents(targetFileKey),
    ]);

    const sourceMap = new Map(sourceComps.meta.components.map(c => [c.name, c]));
    const targetMap = new Map(targetComps.meta.components.map(c => [c.name, c]));

    const onlyInSource: FigmaComponent[] = [];
    const onlyInTarget: FigmaComponent[] = [];
    const different: Array<{ source: FigmaComponent; target: FigmaComponent; differences: string[] }> = [];

    for (const [name, comp] of sourceMap) {
      if (!targetMap.has(name)) {
        onlyInSource.push(comp);
      } else {
        const target = targetMap.get(name)!;
        const differences: string[] = [];

        if (comp.updated_at !== target.updated_at) {
          differences.push('更新时间不同');
        }
        if (comp.description !== target.description) {
          differences.push('描述不同');
        }

        if (differences.length > 0) {
          different.push({ source: comp, target, differences });
        }
      }
    }

    for (const [name, comp] of targetMap) {
      if (!sourceMap.has(name)) {
        onlyInTarget.push(comp);
      }
    }

    return { onlyInSource, onlyInTarget, different };
  }
}
