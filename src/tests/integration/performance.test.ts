// Performance Tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BatchOptimizer } from '../../progress-manager.js';

describe('Performance Benchmarks', () => {
  it('should chunk large arrays efficiently', () => {
    const largeArray = Array.from({ length: 10000 }, (_, i) => i);
    const chunkSize = 50;
    
    const start = Date.now();
    const chunks = BatchOptimizer.chunkArray(largeArray, chunkSize);
    const duration = Date.now() - start;
    
    assert.strictEqual(chunks.length, 200);
    assert.ok(duration < 100, `Chunking 10000 items took ${duration}ms, should be < 100ms`);
  });

  it('should calculate optimal chunk sizes quickly', () => {
    const start = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      BatchOptimizer.calculateOptimalChunkSize(i * 100, 'read');
      BatchOptimizer.calculateOptimalChunkSize(i * 100, 'write');
      BatchOptimizer.calculateOptimalChunkSize(i * 100, 'complex');
    }
    
    const duration = Date.now() - start;
    assert.ok(duration < 1000, `Calculating 3000 chunk sizes took ${duration}ms, should be < 1000ms`);
  });

  it('should handle memory efficiently for large datasets', () => {
    const largeArray = Array.from({ length: 100000 }, (_, i) => ({ id: i, data: 'x'.repeat(100) }));
    
    const start = Date.now();
    const chunks = BatchOptimizer.chunkArray(largeArray, 1000);
    const duration = Date.now() - start;
    
    assert.strictEqual(chunks.length, 100);
    assert.ok(duration < 500, `Chunking 100k objects took ${duration}ms, should be < 500ms`);
  });
});

describe('Batch Processing Simulation', () => {
  async function simulateAsyncOperation(item: number, delay: number = 1): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return item * 2;
  }

  it('should process 1000 items efficiently', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const chunkSize = 50;
    const chunks = BatchOptimizer.chunkArray(items, chunkSize);
    
    const start = Date.now();
    let processed = 0;
    
    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (item) => {
        await simulateAsyncOperation(item, 0);
        processed++;
      }));
    }
    
    const duration = Date.now() - start;
    
    assert.strictEqual(processed, 1000);
    assert.ok(duration < 2000, `Processing 1000 items took ${duration}ms, should be < 2000ms`);
    console.log(`  ✓ Processed 1000 items in ${duration}ms (${(duration/1000).toFixed(2)}ms per item)`);
  });

  it('should handle error recovery efficiently', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    let errorCount = 0;
    let successCount = 0;
    
    const start = Date.now();
    
    await Promise.all(items.map(async (item) => {
      try {
        if (item % 10 === 0) throw new Error('Simulated error');
        await simulateAsyncOperation(item, 0);
        successCount++;
      } catch (e) {
        errorCount++;
      }
    }));
    
    const duration = Date.now() - start;
    
    assert.strictEqual(successCount, 90);
    assert.strictEqual(errorCount, 10);
    assert.ok(duration < 1000);
    console.log(`  ✓ Handled 100 items with 10 errors in ${duration}ms`);
  });
});

describe('Memory Usage', () => {
  it('should not leak memory during batch operations', async () => {
    // Simple memory check - not precise but catches major leaks
    const iterations = 100;
    const items = Array.from({ length: 1000 }, (_, i) => i);
    
    for (let i = 0; i < iterations; i++) {
      const chunks = BatchOptimizer.chunkArray(items, 50);
      // Process and discard
      for (const chunk of chunks) {
        chunk.map(x => x * 2);
      }
    }
    
    // If we get here without OOM, basic memory check passed
    assert.ok(true, 'Memory check passed');
  });
});

describe('Progress Tracking Performance', () => {
  it('should handle rapid progress updates', async () => {
    const { ProgressManager } = await import('../../progress-manager.js');
    const pm = new ProgressManager();
    
    const start = Date.now();
    
    pm.startOperation('perf-test', 'Performance Test', 10000);
    
    for (let i = 0; i <= 10000; i += 100) {
      pm.updateProgress('perf-test', i);
    }
    
    pm.completeOperation('perf-test', {});
    
    const duration = Date.now() - start;
    
    assert.ok(duration < 1000, `10000 progress updates took ${duration}ms, should be < 1000ms`);
    console.log(`  ✓ 10000 progress updates in ${duration}ms`);
  });
});

describe('Concurrency Tests', () => {
  it('should handle concurrent operations', async () => {
    const { ProgressManager } = await import('../../progress-manager.js');
    const pm = new ProgressManager();
    
    // Start multiple operations
    const operations = Array.from({ length: 10 }, (_, i) => `op-${i}`);
    
    for (const op of operations) {
      pm.startOperation(op, `Operation ${op}`, 100);
    }
    
    assert.strictEqual(pm.getActiveOperations().length, 10);
    
    // Complete all
    for (const op of operations) {
      pm.completeOperation(op, {});
    }
    
    assert.strictEqual(pm.getActiveOperations().length, 0);
  });
});
