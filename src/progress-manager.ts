// Progress Manager - 实时进度反馈系统
import { EventEmitter } from 'events';

export interface ProgressUpdate {
  operationId: string;
  operationName: string;
  current: number;
  total: number;
  message: string;
  percentage: number;
  eta?: number; // 预计剩余时间(秒)
  stage?: string; // 当前阶段
}

export interface OperationStage {
  name: string;
  weight: number; // 阶段权重(0-1)
}

export class ProgressManager extends EventEmitter {
  private operations: Map<string, {
    name: string;
    startTime: number;
    stages: OperationStage[];
    currentStage: number;
    stageProgress: number;
    totalItems: number;
    processedItems: number;
  }> = new Map();

  // 开始一个新操作
  startOperation(operationId: string, name: string, totalItems: number, stages?: OperationStage[]): void {
    const defaultStages: OperationStage[] = [
      { name: '准备', weight: 0.1 },
      { name: '处理中', weight: 0.8 },
      { name: '收尾', weight: 0.1 },
    ];

    this.operations.set(operationId, {
      name,
      startTime: Date.now(),
      stages: stages || defaultStages,
      currentStage: 0,
      stageProgress: 0,
      totalItems,
      processedItems: 0,
    });

    this.emit('progress', this.getProgress(operationId));
  }

  // 更新进度
  updateProgress(operationId: string, processedItems: number, message?: string): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    op.processedItems = processedItems;
    op.stageProgress = processedItems / op.totalItems;

    const progress = this.getProgress(operationId);
    progress.message = message || `处理 ${processedItems}/${op.totalItems}`;
    
    this.emit('progress', progress);
  }

  // 进入下一阶段
  nextStage(operationId: string, message?: string): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    op.currentStage++;
    op.stageProgress = 0;

    const progress = this.getProgress(operationId);
    progress.message = message || `阶段: ${op.stages[op.currentStage]?.name || '完成'}`;
    
    this.emit('progress', progress);
  }

  // 完成操作
  completeOperation(operationId: string, result?: any): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    const duration = (Date.now() - op.startTime) / 1000;
    
    this.emit('complete', {
      operationId,
      name: op.name,
      duration,
      result,
    });

    this.operations.delete(operationId);
  }

  // 获取当前进度
  getProgress(operationId: string): ProgressUpdate {
    const op = this.operations.get(operationId);
    if (!op) {
      return {
        operationId,
        operationName: 'Unknown',
        current: 0,
        total: 0,
        message: '操作不存在',
        percentage: 0,
      };
    }

    // 计算总体进度
    let completedWeight = 0;
    for (let i = 0; i < op.currentStage; i++) {
      completedWeight += op.stages[i]?.weight || 0;
    }
    const currentStageWeight = op.stages[op.currentStage]?.weight || 0;
    const stageContribution = currentStageWeight * op.stageProgress;
    const percentage = Math.round((completedWeight + stageContribution) * 100);

    // 计算 ETA
    const elapsed = (Date.now() - op.startTime) / 1000;
    const rate = op.processedItems / elapsed;
    const remaining = op.totalItems - op.processedItems;
    const eta = rate > 0 ? Math.round(remaining / rate) : undefined;

    return {
      operationId,
      operationName: op.name,
      current: op.processedItems,
      total: op.totalItems,
      message: '',
      percentage: Math.min(percentage, 100),
      eta,
      stage: op.stages[op.currentStage]?.name,
    };
  }

  // 获取所有活动操作
  getActiveOperations(): string[] {
    return Array.from(this.operations.keys());
  }

  // 取消操作
  cancelOperation(operationId: string): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    this.emit('cancelled', {
      operationId,
      name: op.name,
      processedItems: op.processedItems,
      totalItems: op.totalItems,
    });

    this.operations.delete(operationId);
  }
}

// 批处理优化器
export class BatchOptimizer {
  // 根据项目大小和类型计算最优批处理大小
  static calculateOptimalChunkSize(
    totalItems: number,
    operationType: 'read' | 'write' | 'modify' | 'complex'
  ): number {
    const baseSizes: Record<string, number> = {
      read: 100,      // 读取操作可以批量更大
      write: 50,      // 写入适中
      modify: 30,     // 修改较小
      complex: 10,    // 复杂操作最小
    };

    const base = baseSizes[operationType] || 50;
    
    // 根据总量调整
    if (totalItems > 10000) return Math.min(base, 20);
    if (totalItems > 5000) return Math.min(base, 30);
    if (totalItems > 1000) return Math.min(base, 50);
    
    return base;
  }

  // 计算建议的并发数
  static calculateConcurrency(totalItems: number): number {
    if (totalItems > 10000) return 1;  // 大量项目，串行处理
    if (totalItems > 5000) return 2;
    if (totalItems > 1000) return 3;
    return 5;  // 小量项目可以更高并发
  }

  // 将数组分批
  static chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // 智能批处理执行
  static async executeBatched<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    options: {
      operationType?: 'read' | 'write' | 'modify' | 'complex';
      chunkSize?: number;
      onProgress?: (current: number, total: number, results: R[]) => void;
      continueOnError?: boolean;
    } = {}
  ): Promise<{ results: R[]; errors: Array<{ item: T; error: string }> }> {
    const {
      operationType = 'modify',
      chunkSize = this.calculateOptimalChunkSize(items.length, operationType),
      onProgress,
      continueOnError = true,
    } = options;

    const chunks = this.chunkArray(items, chunkSize);
    const results: R[] = [];
    const errors: Array<{ item: T; error: string }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        const chunkResults = await processor(chunk);
        results.push(...chunkResults);
      } catch (error) {
        if (!continueOnError) throw error;
        
        // 记录错误并继续
        const errorMsg = error instanceof Error ? error.message : String(error);
        chunk.forEach(item => errors.push({ item, error: errorMsg }));
      }

      // 进度回调
      const processedCount = (i + 1) * chunkSize;
      onProgress?.(
        Math.min(processedCount, items.length),
        items.length,
        results
      );

      // 小延迟让出时间片，避免阻塞
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    return { results, errors };
  }
}

// 性能监控器
export class PerformanceMonitor {
  private metrics: Map<string, {
    count: number;
    totalTime: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
  }> = new Map();

  record(operation: string, duration: number): void {
    const existing = this.metrics.get(operation);
    
    if (existing) {
      existing.count++;
      existing.totalTime += duration;
      existing.avgTime = existing.totalTime / existing.count;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
    } else {
      this.metrics.set(operation, {
        count: 1,
        totalTime: duration,
        avgTime: duration,
        minTime: duration,
        maxTime: duration,
      });
    }
  }

  getReport(): Array<{
    operation: string;
    count: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
  }> {
    return Array.from(this.metrics.entries()).map(([operation, data]) => ({
      operation,
      ...data,
    }));
  }

  // 获取性能建议
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    
    for (const [operation, data] of this.metrics) {
      if (data.avgTime > 1000) {
        recommendations.push(`${operation}: 平均耗时 ${data.avgTime.toFixed(0)}ms，建议增加批处理大小`);
      }
      if (data.maxTime > data.avgTime * 5) {
        recommendations.push(`${operation}: 最大耗时异常(${data.maxTime.toFixed(0)}ms)，可能有性能瓶颈`);
      }
    }
    
    return recommendations;
  }
}
