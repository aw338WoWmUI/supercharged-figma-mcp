// Unit Tests for Progress Manager
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProgressManager, BatchOptimizer, PerformanceMonitor } from '../../progress-manager.js';

describe('ProgressManager', () => {
  let pm: ProgressManager;

  beforeEach(() => {
    pm = new ProgressManager();
  });

  it('should start an operation', () => {
    pm.startOperation('op-1', 'Test Operation', 100);
    const activeOps = pm.getActiveOperations();
    assert.strictEqual(activeOps.length, 1);
    assert.strictEqual(activeOps[0], 'op-1');
  });

  it('should update progress correctly', () => {
    pm.startOperation('op-1', 'Test', 100);
    pm.updateProgress('op-1', 50, 'Halfway');
    
    const progress = pm.getProgress('op-1');
    assert.strictEqual(progress.current, 50);
    assert.strictEqual(progress.total, 100);
    assert.strictEqual(progress.operationName, 'Test');
  });

  it('should calculate percentage correctly', () => {
    pm.startOperation('op-1', 'Test', 100, [
      { name: 'Stage 1', weight: 0.3 },
      { name: 'Stage 2', weight: 0.7 }
    ]);
    
    // Move to stage 2
    pm.nextStage('op-1');
    pm.updateProgress('op-1', 50);
    const progress = pm.getProgress('op-1');
    
    // Should be 65% (30% for stage 1 + 50% of 70% for stage 2)
    assert.ok(progress.percentage >= 60 && progress.percentage <= 70, 
      `Expected percentage around 65%, got ${progress.percentage}%`);
  });

  it('should complete operation', () => {
    let completed = false;
    pm.on('complete', () => { completed = true; });
    
    pm.startOperation('op-1', 'Test', 100);
    pm.completeOperation('op-1', { result: 'success' });
    
    assert.strictEqual(completed, true);
    assert.strictEqual(pm.getActiveOperations().length, 0);
  });

  it('should cancel operation', () => {
    let cancelled = false;
    pm.on('cancelled', () => { cancelled = true; });
    
    pm.startOperation('op-1', 'Test', 100);
    pm.cancelOperation('op-1');
    
    assert.strictEqual(cancelled, true);
  });
});

describe('BatchOptimizer', () => {
  it('should calculate optimal chunk size for different types', () => {
    const readSize = BatchOptimizer.calculateOptimalChunkSize(1000, 'read');
    const writeSize = BatchOptimizer.calculateOptimalChunkSize(1000, 'write');
    const complexSize = BatchOptimizer.calculateOptimalChunkSize(1000, 'complex');
    
    assert.ok(readSize >= writeSize, 'Read should have larger chunks than write');
    assert.ok(writeSize >= complexSize, 'Write should have larger chunks than complex');
  });

  it('should reduce chunk size for large datasets', () => {
    const smallSize = BatchOptimizer.calculateOptimalChunkSize(100, 'write');
    const largeSize = BatchOptimizer.calculateOptimalChunkSize(20000, 'write');
    
    assert.ok(largeSize < smallSize, 'Large datasets should have smaller chunks');
  });

  it('should chunk array correctly', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chunks = BatchOptimizer.chunkArray(arr, 3);
    
    assert.strictEqual(chunks.length, 4);
    assert.deepStrictEqual(chunks[0], [1, 2, 3]);
    assert.deepStrictEqual(chunks[3], [10]);
  });

  it('should calculate concurrency correctly', () => {
    const low = BatchOptimizer.calculateConcurrency(20000);
    const high = BatchOptimizer.calculateConcurrency(100);
    
    assert.ok(low < high, 'Large datasets should have lower concurrency');
  });
});

describe('PerformanceMonitor', () => {
  it('should record metrics', () => {
    const monitor = new PerformanceMonitor();
    
    monitor.record('test-op', 100);
    monitor.record('test-op', 200);
    monitor.record('test-op', 300);
    
    const report = monitor.getReport();
    assert.strictEqual(report.length, 1);
    assert.strictEqual(report[0].operation, 'test-op');
    assert.strictEqual(report[0].count, 3);
    assert.strictEqual(report[0].avgTime, 200);
  });

  it('should generate recommendations for slow operations', () => {
    const monitor = new PerformanceMonitor();
    
    monitor.record('slow-op', 2000);
    monitor.record('slow-op', 3000);
    
    const recommendations = monitor.getRecommendations();
    assert.ok(recommendations.length > 0);
    assert.ok(recommendations[0].includes('slow-op'));
  });

  it('should track min and max times', () => {
    const monitor = new PerformanceMonitor();
    
    monitor.record('test', 100);
    monitor.record('test', 500);
    monitor.record('test', 300);
    
    const report = monitor.getReport()[0];
    assert.strictEqual(report.minTime, 100);
    assert.strictEqual(report.maxTime, 500);
  });
});
