// Integration Tests - Tool Validation
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../tools-data.js';

describe('Tools Validation', () => {
  it('should have 122 tools', () => {
    assert.strictEqual(TOOLS.length, 122, 'Expected 122 tools');
  });

  it('should have unique tool names', () => {
    const names = TOOLS.map(t => t.name);
    const uniqueNames = new Set(names);
    assert.strictEqual(uniqueNames.size, names.length, 'Tool names should be unique');
  });

  it('should have valid tool structure', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, 'Tool should have a name');
      assert.ok(tool.description, 'Tool should have a description');
      assert.ok(tool.inputSchema, 'Tool should have inputSchema');
      assert.strictEqual(tool.inputSchema.type, 'object', 'inputSchema type should be object');
    }
  });

  it('should categorize tools correctly', () => {
    const categories: Record<string, (string | string[])[]> = {
      'Smart Discovery': ['smart_select', 'find_similar', 'scan_by_pattern', 'auto_discover_components'],
      'Batch Operations': ['batch_create', 'batch_modify', 'batch_clone', 'batch_rename', 'batch_delete', 'batch_edit_across_pages'],
      'Component System': ['create_component_from_nodes', 'create_variant_set', 'auto_create_variants', 'merge_to_component', 'detach_instance', 'swap_component', 'frame_to_components', 'explode_component_set', 'split_component_by_variants', 'merge_components_to_set', 'convert_instances_to_components', 'detach_and_organize', 'add_component_property', 'set_component_property', 'remove_component_property'],
      'Prototype System': ['create_interaction', 'batch_connect', 'copy_prototype', 'create_flow'],
      'Style System': ['create_color_style', 'create_text_style', 'create_effect_style', 'create_grid_style', 'update_paint_style', 'update_text_style', 'delete_style', 'get_all_styles', 'apply_style_to_nodes', 'sync_styles_to_library'],
      'Variables': ['create_variable', 'create_variable_collection', 'set_variable_value', 'bind_variable_to_node', 'unbind_variable', 'get_all_variables', 'delete_variable'],
      'Page Management': ['create_page', 'delete_page', 'rename_page', 'reorder_pages', 'duplicate_page'],
      'REST API': TOOLS.filter(t => t.name.startsWith('rest_')).map(t => t.name),
      'System': ['get_performance_report', 'cancel_operation', 'get_active_operations'],
    };

    const toolNames = new Set(TOOLS.map(t => t.name));

    for (const [category, tools] of Object.entries(categories)) {
      for (const toolName of tools as string[]) {
        assert.ok(toolNames.has(toolName), `Category "${category}" should include tool "${toolName}"`);
      }
    }
  });

  it('should have tools for all major Figma features', () => {
    const requiredFeatures = [
      // Node creation
      ['create_frame', 'create_rectangle', 'create_text', 'create_ellipse', 'create_vector'],
      // Component operations
      ['create_component_from_nodes', 'create_variant_set', 'detach_instance'],
      // Prototype
      ['create_interaction', 'batch_connect'],
      // Styles
      ['create_color_style', 'create_text_style'],
      // Variables
      ['create_variable', 'create_variable_collection'],
      // Export
      ['export_node', 'export_nodes_batch'],
      // Boolean operations
      ['union_nodes', 'subtract_nodes', 'intersect_nodes', 'exclude_nodes'],
      // Page management
      ['create_page', 'duplicate_page'],
      // Cross-page
      ['cross_page_copy', 'cross_page_move'],
    ];

    const toolNames = new Set(TOOLS.map(t => t.name));

    for (const featureGroup of requiredFeatures) {
      const hasAtLeastOne = featureGroup.some(name => toolNames.has(name));
      assert.ok(hasAtLeastOne, `Should have at least one tool from group: ${featureGroup.join(', ')}`);
    }
  });

  it('should have consistent naming conventions', () => {
    interface Tool { name: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } }
    const tools = TOOLS as Tool[];
    const namingPatterns: Record<string, number> = {
      'create_': tools.filter((t: Tool) => t.name.startsWith('create_')).length,
      'batch_': tools.filter((t: Tool) => t.name.startsWith('batch_')).length,
      'set_': tools.filter((t: Tool) => t.name.startsWith('set_')).length,
      'get_': tools.filter((t: Tool) => t.name.startsWith('get_')).length,
      'rest_': tools.filter((t: Tool) => t.name.startsWith('rest_')).length,
    };

    console.log('Naming patterns:', namingPatterns);
    
    assert.ok(namingPatterns['create_'] >= 15, 'Should have many create_ tools');
    assert.ok(namingPatterns['batch_'] >= 5, 'Should have batch_ tools');
    assert.ok(namingPatterns['rest_'] >= 10, 'Should have REST API tools');
  });

  it('should have proper descriptions', () => {
    interface Tool { name: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } }
    for (const tool of TOOLS as Tool[]) {
      assert.ok(tool.description.length > 10, `Tool ${tool.name} should have meaningful description`);
      assert.ok(!tool.description.endsWith('.'), `Tool ${tool.name} description should not end with period (MCP convention)`);
    }
  });

  it('should have valid input schemas', () => {
    interface Tool { name: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } }
    for (const tool of TOOLS as Tool[]) {
      const schema = tool.inputSchema;
      
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          assert.ok(propSchema && typeof propSchema === 'object', 
            `Tool ${tool.name} property ${propName} should be valid schema`);
        }
      }

      if (schema.required) {
        assert.ok(Array.isArray(schema.required), 
          `Tool ${tool.name} required should be an array`);
      }
    }
  });
});

describe('Tool Coverage', () => {
  const figmaApiFeatures = [
    'Node Creation',
    'Node Modification',
    'Component Operations',
    'Variant Management',
    'Prototype Interactions',
    'Style Management',
    'Variable System',
    'Export',
    'Boolean Operations',
    'Auto Layout',
    'Page Management',
  ];

  it('should cover all major Figma API features', () => {
    const toolCategories = new Set<string>();
    
    for (const tool of TOOLS) {
      if (tool.name.includes('create')) toolCategories.add('Node Creation');
      if (tool.name.includes('modify') || tool.name.includes('set')) toolCategories.add('Node Modification');
      if (tool.name.includes('component')) toolCategories.add('Component Operations');
      if (tool.name.includes('variant')) toolCategories.add('Variant Management');
      if (tool.name.includes('interaction') || tool.name.includes('prototype')) toolCategories.add('Prototype Interactions');
      if (tool.name.includes('style')) toolCategories.add('Style Management');
      if (tool.name.includes('variable')) toolCategories.add('Variable System');
      if (tool.name.includes('export')) toolCategories.add('Export');
      if (tool.name.includes('union') || tool.name.includes('subtract')) toolCategories.add('Boolean Operations');
      if (tool.name.includes('layout') || tool.name.includes('auto_layout')) toolCategories.add('Auto Layout');
      if (tool.name.includes('page')) toolCategories.add('Page Management');
    }

    console.log('Covered categories:', Array.from(toolCategories));
    
    for (const feature of figmaApiFeatures) {
      assert.ok(toolCategories.has(feature) || hasRelatedTools(feature), 
        `Should cover feature: ${feature}`);
    }
  });
});

function hasRelatedTools(feature: string): boolean {
  const featureKeywords: Record<string, string[]> = {
    'Node Creation': ['create_', 'batch_create'],
    'Node Modification': ['modify', 'set_', 'update_'],
    'Component Operations': ['component', 'instance'],
    'Variant Management': ['variant', 'set'],
    'Prototype Interactions': ['interaction', 'prototype', 'flow'],
    'Style Management': ['style'],
    'Variable System': ['variable'],
    'Export': ['export', 'slice'],
    'Boolean Operations': ['union', 'subtract', 'intersect', 'exclude', 'flatten'],
    'Auto Layout': ['auto_layout', 'layout_mode', 'align', 'distribute'],
    'Page Management': ['page'],
  };

  interface Tool { name: string }
  const keywords = featureKeywords[feature] || [];
  return (TOOLS as Tool[]).some((t: Tool) => keywords.some(k => t.name.includes(k)));
}
