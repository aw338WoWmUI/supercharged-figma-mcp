// Test Suite Entry Point
import { describe, it } from 'node:test';
import assert from 'node:assert';
import './unit/progress-manager.test.js';
import './unit/batch-operations.test.js';
import './integration/tools-validation.test.js';
import './integration/performance.test.js';
import './integration/relay-protocol.test.js';

describe('Supercharged Figma MCP - Test Suite', () => {
  it('should load all test modules', () => {
    assert.ok(true, 'All test modules loaded successfully');
  });
});

console.log('\n' + '='.repeat(60));
console.log('Supercharged Figma MCP - Test Suite');
console.log('='.repeat(60) + '\n');
