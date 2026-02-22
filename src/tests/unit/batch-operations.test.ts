// Unit Tests for Enhanced Batch Operations
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EnhancedBatchExecutor } from '../../enhanced-batch-operations.js';
import { ProgressManager } from '../../progress-manager.js';

describe('EnhancedBatchExecutor', () => {
  let pm: ProgressManager;
  let executor: EnhancedBatchExecutor;

  beforeEach(() => {
    pm = new ProgressManager();
    executor = new EnhancedBatchExecutor(pm);
  });

  it('should execute batch successfully', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = async (item: number) => item * 2;
    
    const result = await executor.execute(
      { operationId: 'test-1', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      processor
    );
    
    assert.strictEqual(result.success.length, 5);
    assert.deepStrictEqual(result.success, [2, 4, 6, 8, 10]);
    assert.strictEqual(result.failed.length, 0);
  });

  it('should handle errors with continueOnError', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = async (item: number) => {
      if (item === 3) throw new Error('Test error');
      return item * 2;
    };
    
    const result = await executor.execute(
      { operationId: 'test-2', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      processor
    );
    
    assert.strictEqual(result.success.length, 4);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].item, 3);
  });

  it('should throw on error without continueOnError', async () => {
    const items = [1, 2, 3];
    const processor = async () => { throw new Error('Fail'); };
    
    await assert.rejects(
      executor.execute(
        { operationId: 'test-3', name: 'Test', totalItems: items.length, operationType: 'read', continueOnError: false },
        items,
        processor
      ),
      /Fail/
    );
  });

  it('should execute in parallel for read operations', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = async (item: number) => item * 2;
    
    const startTime = Date.now();
    const result = await executor.executeParallel(
      { operationId: 'test-4', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      processor,
      3 // maxConcurrency
    );
    const duration = Date.now() - startTime;
    
    assert.strictEqual(result.success.length, 5);
    assert.ok(duration < 1000, 'Should complete quickly with parallel execution');
  });

  it('should retry failed operations', async () => {
    let attempts = 0;
    const items = [1];
    const processor = async () => {
      attempts++;
      if (attempts < 3) throw new Error('Retry me');
      return 'success';
    };
    
    const result = await executor.executeWithRetry(
      { operationId: 'test-5', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      processor,
      3 // maxRetries
    );
    
    assert.strictEqual(result.success.length, 1);
    assert.strictEqual(attempts, 3);
  });

  it('should provide summary statistics', async () => {
    const items = [1, 2, 3];
    const processor = async (item: number) => item;
    
    const result = await executor.execute(
      { operationId: 'test-6', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      processor
    );
    
    assert.strictEqual(result.summary.total, 3);
    assert.strictEqual(result.summary.succeeded, 3);
    assert.strictEqual(result.summary.failed, 0);
    assert.ok(result.summary.duration >= 0);
    assert.ok(result.summary.avgItemTime >= 0);
  });

  it('should handle empty arrays', async () => {
    const result = await executor.execute(
      { operationId: 'test-7', name: 'Test', totalItems: 0, operationType: 'read' },
      [],
      async (item) => item
    );
    
    assert.strictEqual(result.success.length, 0);
    assert.strictEqual(result.summary.total, 0);
  });

  it('should call cleanup function', async () => {
    let cleaned = false;
    const items = [1];
    
    await executor.execute(
      { operationId: 'test-8', name: 'Test', totalItems: items.length, operationType: 'read' },
      items,
      async (item) => item,
      async () => { cleaned = true; }
    );
    
    assert.strictEqual(cleaned, true);
  });

  it('should provide performance report', () => {
    const report = executor.getPerformanceReport();
    
    assert.ok(Array.isArray(report.operations));
    assert.ok(Array.isArray(report.recommendations));
  });
});

describe('Stream Processing', () => {
  it('should process items in stream', async () => {
    const pm = new ProgressManager();
    const executor = new EnhancedBatchExecutor(pm);
    
    async function* generateItems() {
      for (let i = 1; i <= 5; i++) {
        yield i;
      }
    }
    
    const results: number[] = [];
    const stream = executor.executeStream<number, number>(
      { operationId: 'stream-test', name: 'Stream Test', operationType: 'read' },
      generateItems(),
      async (item) => item * 2
    );
    
    for await (const event of stream) {
      if (event.type === 'result') {
        results.push(event.data);
      }
    }
    
    assert.deepStrictEqual(results, [2, 4, 6, 8, 10]);
  });
});
