// Test data for tools validation
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOLS: Tool[] = [
  // Smart Discovery
  { name: 'smart_select', description: 'AI-powered node selection using natural language', inputSchema: { type: 'object', properties: {} } },
  { name: 'find_similar', description: 'Find similar nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'scan_by_pattern', description: 'Scan nodes by pattern', inputSchema: { type: 'object', properties: {} } },
  { name: 'auto_discover_components', description: 'Auto discover component opportunities', inputSchema: { type: 'object', properties: {} } },
  
  // Batch Operations
  { name: 'batch_create', description: 'Batch create nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_modify', description: 'Batch modify nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_clone', description: 'Batch clone nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_rename', description: 'Batch rename nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_delete', description: 'Batch delete nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_edit_across_pages', description: 'Batch edit across pages', inputSchema: { type: 'object', properties: {} } },
  
  // Component System
  { name: 'create_component_from_nodes', description: 'Create component from nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_variant_set', description: 'Create variant set', inputSchema: { type: 'object', properties: {} } },
  { name: 'auto_create_variants', description: 'Auto create variants', inputSchema: { type: 'object', properties: {} } },
  { name: 'merge_to_component', description: 'Merge to component', inputSchema: { type: 'object', properties: {} } },
  { name: 'detach_instance', description: 'Detach instance', inputSchema: { type: 'object', properties: {} } },
  { name: 'swap_component', description: 'Swap component', inputSchema: { type: 'object', properties: {} } },
  { name: 'frame_to_components', description: 'Frame to components', inputSchema: { type: 'object', properties: {} } },
  { name: 'explode_component_set', description: 'Explode component set', inputSchema: { type: 'object', properties: {} } },
  { name: 'split_component_by_variants', description: 'Split by variants', inputSchema: { type: 'object', properties: {} } },
  { name: 'merge_components_to_set', description: 'Merge to set', inputSchema: { type: 'object', properties: {} } },
  { name: 'convert_instances_to_components', description: 'Convert instances', inputSchema: { type: 'object', properties: {} } },
  { name: 'detach_and_organize', description: 'Detach and organize', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_component_property', description: 'Add component property', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_component_property', description: 'Set component property', inputSchema: { type: 'object', properties: {} } },
  { name: 'remove_component_property', description: 'Remove component property', inputSchema: { type: 'object', properties: {} } },
  
  // Prototype
  { name: 'create_interaction', description: 'Create interaction', inputSchema: { type: 'object', properties: {} } },
  { name: 'batch_connect', description: 'Batch connect', inputSchema: { type: 'object', properties: {} } },
  { name: 'copy_prototype', description: 'Copy prototype', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_flow', description: 'Create flow', inputSchema: { type: 'object', properties: {} } },
  
  // Styles
  { name: 'create_color_style', description: 'Create color style', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_text_style', description: 'Create text style', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_effect_style', description: 'Create effect style', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_grid_style', description: 'Create grid style', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_paint_style', description: 'Update paint style', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_text_style', description: 'Update text style', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_style', description: 'Delete style', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_all_styles', description: 'Get all styles', inputSchema: { type: 'object', properties: {} } },
  { name: 'apply_style_to_nodes', description: 'Apply style to nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync_styles_to_library', description: 'Sync to library', inputSchema: { type: 'object', properties: {} } },
  
  // Variables
  { name: 'create_variable', description: 'Create variable', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_variable_collection', description: 'Create collection', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_variable_value', description: 'Set variable value', inputSchema: { type: 'object', properties: {} } },
  { name: 'bind_variable_to_node', description: 'Bind variable', inputSchema: { type: 'object', properties: {} } },
  { name: 'unbind_variable', description: 'Unbind variable', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_all_variables', description: 'Get all variables', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_variable', description: 'Delete variable', inputSchema: { type: 'object', properties: {} } },
  
  // Basic Creation
  { name: 'create_ellipse', description: 'Create ellipse', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_line', description: 'Create line', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_polygon', description: 'Create polygon', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_star', description: 'Create star', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_vector', description: 'Create vector', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_group', description: 'Create group', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_section', description: 'Create section', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_slice', description: 'Create slice', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_connector', description: 'Create connector', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_sticky', description: 'Create sticky', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_shape_with_text', description: 'Create shape with text', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_table', description: 'Create table', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_frame', description: 'Create frame', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_rectangle', description: 'Create rectangle', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_text', description: 'Create text', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_component', description: 'Create component', inputSchema: { type: 'object', properties: {} } },
  
  // Boolean Operations
  { name: 'union_nodes', description: 'Union nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'subtract_nodes', description: 'Subtract nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'intersect_nodes', description: 'Intersect nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'exclude_nodes', description: 'Exclude nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'flatten_nodes', description: 'Flatten nodes', inputSchema: { type: 'object', properties: {} } },
  
  // Properties
  { name: 'set_constraints', description: 'Set constraints', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_layout_grid', description: 'Set layout grid', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_effects', description: 'Set effects', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_export_settings', description: 'Set export settings', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_blend_mode', description: 'Set blend mode', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_mask', description: 'Set or remove mask on a node', inputSchema: { type: 'object', properties: {} } },
  
  // Auto Layout
  { name: 'set_auto_layout', description: 'Set auto layout', inputSchema: { type: 'object', properties: {} } },
  { name: 'remove_auto_layout', description: 'Remove auto layout', inputSchema: { type: 'object', properties: {} } },
  { name: 'align_nodes', description: 'Align nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'distribute_nodes', description: 'Distribute nodes', inputSchema: { type: 'object', properties: {} } },
  
  // Page Management
  { name: 'create_page', description: 'Create page', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_page', description: 'Delete page', inputSchema: { type: 'object', properties: {} } },
  { name: 'rename_page', description: 'Rename page', inputSchema: { type: 'object', properties: {} } },
  { name: 'reorder_pages', description: 'Reorder pages', inputSchema: { type: 'object', properties: {} } },
  { name: 'duplicate_page', description: 'Duplicate page', inputSchema: { type: 'object', properties: {} } },
  
  // Cross Page
  { name: 'cross_page_copy', description: 'Cross page copy', inputSchema: { type: 'object', properties: {} } },
  { name: 'cross_page_move', description: 'Cross page move', inputSchema: { type: 'object', properties: {} } },
  
  // Export
  { name: 'create_image_fill', description: 'Create image fill', inputSchema: { type: 'object', properties: {} } },
  { name: 'export_node', description: 'Export node', inputSchema: { type: 'object', properties: {} } },
  { name: 'export_nodes_batch', description: 'Batch export', inputSchema: { type: 'object', properties: {} } },
  
  // Transform
  { name: 'scale_nodes', description: 'Scale nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'flip_horizontal', description: 'Flip horizontal', inputSchema: { type: 'object', properties: {} } },
  { name: 'flip_vertical', description: 'Flip vertical', inputSchema: { type: 'object', properties: {} } },
  
  // REST API
  { name: 'rest_get_file', description: 'REST get file', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_get_file_nodes', description: 'REST get nodes', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_get_team_components', description: 'REST get team components', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_get_file_components', description: 'REST get file components', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_get_team_styles', description: 'REST get team styles', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_export_nodes', description: 'REST export', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_batch_export', description: 'REST batch export', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_download_image', description: 'REST download', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_copy_component_to_local', description: 'REST copy component', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_compare_components', description: 'REST compare', inputSchema: { type: 'object', properties: {} } },
  { name: 'rest_get_rate_limit', description: 'REST rate limit', inputSchema: { type: 'object', properties: {} } },
  
  // Intelligence
  { name: 'analyze_duplicates', description: 'Analyze duplicates', inputSchema: { type: 'object', properties: {} } },
  { name: 'analyze_frame_structure', description: 'Analyze frame structure', inputSchema: { type: 'object', properties: {} } },
  { name: 'suggest_component_structure', description: 'Suggest structure', inputSchema: { type: 'object', properties: {} } },
  { name: 'generate_naming_scheme', description: 'Generate naming', inputSchema: { type: 'object', properties: {} } },
  { name: 'check_consistency', description: 'Check consistency', inputSchema: { type: 'object', properties: {} } },
  
  // System
  { name: 'get_performance_report', description: 'Performance report', inputSchema: { type: 'object', properties: {} } },
  { name: 'cancel_operation', description: 'Cancel operation', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_active_operations', description: 'Active operations', inputSchema: { type: 'object', properties: {} } },
  
  // Text
  { name: 'set_multiple_text_contents', description: 'Set multiple text contents at once', inputSchema: { type: 'object', properties: {} } },
  { name: 'undo_operations', description: 'Undo previous operations', inputSchema: { type: 'object', properties: {} } },
  
  // Missing tools
  { name: 'import_component_from_file', description: 'Import component from another file', inputSchema: { type: 'object', properties: {} } },
  { name: 'import_style_from_file', description: 'Import style from another file', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_node_info', description: 'Get detailed node information', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_document_info', description: 'Get document structure', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_layout_mode', description: 'Set frame layout mode', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_item_spacing', description: 'Set item spacing', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_layout_sizing', description: 'Set layout sizing', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_padding', description: 'Set frame padding', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_corner_radius', description: 'Set corner radius', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_fill_color', description: 'Set fill color', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_stroke_color', description: 'Set stroke color', inputSchema: { type: 'object', properties: {} } },
];
