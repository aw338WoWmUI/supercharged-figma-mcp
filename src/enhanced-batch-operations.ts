// Enhanced Batch Operations with Performance Optimization
import { ProgressManager, BatchOptimizer, PerformanceMonitor } from './progress-manager.js';

export interface BatchOperationConfig {
  operationId: string;
  name: string;
  totalItems: number;
  operationType: 'read' | 'write' | 'modify' | 'complex';
  chunkSize?: number;
  continueOnError?: boolean;
  stages?: Array<{ name: string; weight: number }>;
}

export interface BatchResult<T> {
  success: T[];
  failed: Array<{ item: any; error: string; index: number }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    duration: number;
    avgItemTime: number;
  };
}

// 增强型批处理执行器
export class EnhancedBatchExecutor {
  private progressManager: ProgressManager;
  private performanceMonitor: PerformanceMonitor;

  constructor(progressManager: ProgressManager) {
    this.progressManager = progressManager;
    this.performanceMonitor = new PerformanceMonitor();
  }

  // 执行带进度跟踪的批处理
  async execute<T, R>(
    config: BatchOperationConfig,
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    cleanup?: () => Promise<void>
  ): Promise<BatchResult<R>> {
    const startTime = Date.now();
    const { operationId, name, operationType, continueOnError = true } = config;

    // 计算最优参数
    const chunkSize = config.chunkSize || BatchOptimizer.calculateOptimalChunkSize(
      config.totalItems,
      operationType
    );

    // 开始操作
    this.progressManager.startOperation(operationId, name, config.totalItems, config.stages);

    const success: R[] = [];
    const failed: Array<{ item: any; error: string; index: number }> = [];

    try {
      // 阶段1: 准备
      this.progressManager.nextStage(operationId, '准备数据...');
      await this.delay(50); // 模拟准备时间

      // 阶段2: 处理
      this.progressManager.nextStage(operationId, '开始处理...');

      const chunks = BatchOptimizer.chunkArray(items, chunkSize);
      
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const baseIndex = chunkIndex * chunkSize;

        // 处理当前批次
        for (let i = 0; i < chunk.length; i++) {
          const item = chunk[i];
          const globalIndex = baseIndex + i;

          const itemStartTime = Date.now();

          try {
            const result = await processor(item, globalIndex);
            success.push(result);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            failed.push({ item: item as any, error: errorMsg, index: globalIndex });

            if (!continueOnError) {
              throw error;
            }
          }

          // 记录性能
          this.performanceMonitor.record(name, Date.now() - itemStartTime);
        }

        // 更新进度
        const processedCount = Math.min((chunkIndex + 1) * chunkSize, config.totalItems);
        this.progressManager.updateProgress(
          operationId,
          processedCount,
          `处理中... ${processedCount}/${config.totalItems} (${Math.round(processedCount / config.totalItems * 100)}%)`
        );

        // 让出时间片
        if (chunkIndex < chunks.length - 1) {
          await this.delay(10);
        }
      }

      // 阶段3: 收尾
      this.progressManager.nextStage(operationId, '完成...');
      
      if (cleanup) {
        await cleanup();
      }

    } catch (error) {
      this.progressManager.cancelOperation(operationId);
      throw error;
    }

    const duration = Date.now() - startTime;
    
    // 完成操作
    this.progressManager.completeOperation(operationId, {
      succeeded: success.length,
      failed: failed.length,
      duration,
    });

    return {
      success,
      failed,
      summary: {
        total: config.totalItems,
        succeeded: success.length,
        failed: failed.length,
        duration: duration / 1000,
        avgItemTime: duration / config.totalItems,
      },
    };
  }

  // 并行批处理（适用于读取操作）
  async executeParallel<T, R>(
    config: BatchOperationConfig,
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    maxConcurrency: number = 5
  ): Promise<BatchResult<R>> {
    const startTime = Date.now();
    const { operationId, name, continueOnError = true } = config;

    this.progressManager.startOperation(operationId, name, config.totalItems);

    const success: R[] = [];
    const failed: Array<{ item: any; error: string; index: number }> = [];
    let processedCount = 0;

    // 创建工作队列
    const queue = items.map((item, index) => ({ item, index }));
    
    // 并行处理
    const workers = Array(Math.min(maxConcurrency, queue.length))
      .fill(null)
      .map(async () => {
        while (queue.length > 0) {
          const { item, index } = queue.shift()!;

          try {
            const result = await processor(item, index);
            success.push(result);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            failed.push({ item: item as any, error: errorMsg, index });

            if (!continueOnError) {
              throw error;
            }
          }

          processedCount++;
          
          // 每10个更新一次进度
          if (processedCount % 10 === 0 || processedCount === config.totalItems) {
            this.progressManager.updateProgress(
              operationId,
              processedCount,
              `并行处理中... ${processedCount}/${config.totalItems}`
            );
          }
        }
      });

    await Promise.all(workers);

    const duration = Date.now() - startTime;
    
    this.progressManager.completeOperation(operationId, {
      succeeded: success.length,
      failed: failed.length,
      duration,
    });

    return {
      success,
      failed,
      summary: {
        total: config.totalItems,
        succeeded: success.length,
        failed: failed.length,
        duration: duration / 1000,
        avgItemTime: duration / config.totalItems,
      },
    };
  }

  // 智能重试机制
  async executeWithRetry<T, R>(
    config: BatchOperationConfig,
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    maxRetries: number = 3
  ): Promise<BatchResult<R>> {
    const retryMap = new Map<number, number>();
    
    const wrappedProcessor = async (item: T, index: number): Promise<R> => {
      let lastError: Error;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await processor(item, index);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < maxRetries) {
            // 指数退避
            const delay = Math.pow(2, attempt) * 100;
            await this.delay(delay);
            retryMap.set(index, (retryMap.get(index) || 0) + 1);
          }
        }
      }
      
      throw lastError!;
    };

    const result = await this.execute(config, items, wrappedProcessor);
    
    // 添加重试统计
    const totalRetries = Array.from(retryMap.values()).reduce((a, b) => a + b, 0);
    (result.summary as any).retries = totalRetries;
    
    return result;
  }

  // 流式处理（用于超大集合）
  async *executeStream<T, R>(
    config: Omit<BatchOperationConfig, 'totalItems'>,
    items: AsyncIterable<T>,
    processor: (item: T, index: number) => Promise<R>
  ): AsyncGenerator<{ type: 'result'; data: R } | { type: 'error'; error: string; index: number } | { type: 'progress'; current: number }> {
    const { operationId, name } = config;
    let index = 0;
    let currentBatch: T[] = [];
    const batchSize = 50;

    this.progressManager.startOperation(operationId, name, 1000000); // 预估大数

    for await (const item of items) {
      currentBatch.push(item);

      if (currentBatch.length >= batchSize) {
        // 处理当前批次
        for (const batchItem of currentBatch) {
          try {
            const result = await processor(batchItem, index);
            yield { type: 'result', data: result };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            yield { type: 'error', error: errorMsg, index };
          }
          index++;
        }

        currentBatch = [];
        
        // 更新进度
        this.progressManager.updateProgress(operationId, index, `已处理 ${index} 项`);
        yield { type: 'progress', current: index };

        // 让出时间片
        await this.delay(10);
      }
    }

    // 处理剩余项目
    for (const batchItem of currentBatch) {
      try {
        const result = await processor(batchItem, index);
        yield { type: 'result', data: result };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        yield { type: 'error', error: errorMsg, index };
      }
      index++;
    }

    this.progressManager.completeOperation(operationId, { totalProcessed: index });
  }

  // 获取性能报告
  getPerformanceReport(): {
    operations: Array<{
      operation: string;
      count: number;
      avgTime: number;
      minTime: number;
      maxTime: number;
    }>;
    recommendations: string[];
  } {
    return {
      operations: this.performanceMonitor.getReport(),
      recommendations: this.performanceMonitor.getRecommendations(),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
