// Supercharged Figma Plugin - Runtime Engine
// Connection state (WebSocket is in UI thread)
let isConnected = false;
let activeBridgeSessionId = null;
let pendingDisconnectTimer = null;
const TOOL_EXECUTION_TIMEOUT_MS = 120000;
let pluginToolCatalog = null;
function getPluginToolCatalog() {
    if (pluginToolCatalog)
        return pluginToolCatalog;
    const source = handleMessage.toString();
    const matchPattern = /case\s+['\"]([^'\"]+)['\"]\s*:/g;
    const names = new Set();
    let match;
    while ((match = matchPattern.exec(source)) !== null) {
        const toolName = match[1];
        if (!toolName)
            continue;
        names.add(toolName);
    }
    const excluded = new Set(['get_tools', 'progress_update', 'progress_complete', 'log']);
    pluginToolCatalog = [...names]
        .filter((name) => !excluded.has(name))
        .sort()
        .map((name) => ({
        name,
        description: `Figma plugin tool: ${name}`,
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: true,
        },
    }));
    return pluginToolCatalog;
}
function bridgeLog(message, level = 'info') {
    try {
        figma.ui.postMessage({ type: 'log', payload: { message: `[Bridge] ${message}`, level } });
    }
    catch (_a) {
        // Best effort UI log.
    }
}
const DEFAULT_DROP_SHADOW_SPREAD = 0;
function createDropShadowEffect(params) {
    var _a, _b, _c;
    return {
        type: 'DROP_SHADOW',
        visible: true,
        blendMode: 'NORMAL',
        color: params.color,
        offset: {
            x: (_a = params.offsetX) !== null && _a !== void 0 ? _a : 0,
            y: (_b = params.offsetY) !== null && _b !== void 0 ? _b : 0,
        },
        radius: params.radius,
        spread: (_c = params.spread) !== null && _c !== void 0 ? _c : DEFAULT_DROP_SHADOW_SPREAD,
    };
}
// Operation history for undo
const operationHistory = [];
// ===== Message Handler =====
async function handleMessage(message) {
    const { type, id, payload } = message;
    try {
        let result;
        switch (type) {
            // Relay/UI status messages, not executable plugin tools.
            case 'progress_update':
            case 'progress_complete':
            case 'log':
                return { ignored: true };
            case 'get_tools':
                result = { tools: getPluginToolCatalog() };
                break;
            // Smart Discovery
            case 'smart_select':
                result = await smartSelect(payload.query, payload.scope, payload.limit, payload.pageIds, payload.pageNames);
                break;
            case 'find_similar':
                result = await findSimilar(payload.targetId, payload.threshold, payload.scope, payload.pageIds, payload.pageNames);
                break;
            case 'scan_by_pattern':
                result = await scanByPattern(payload.pattern, payload.scope, payload.pageIds, payload.pageNames, payload.limit);
                break;
            case 'auto_discover_components':
                result = await autoDiscoverComponents(payload.minSimilarity, payload.minOccurrences, payload.scope, payload.pageIds, payload.pageNames);
                break;
            // Batch Operations
            case 'batch_create':
                result = await batchCreate(payload.operations, payload.chunkSize, payload.continueOnError);
                break;
            case 'batch_modify':
                result = await batchModify(payload.operations, payload.chunkSize);
                break;
            case 'batch_clone':
                result = await batchClone(payload.templateId, payload.count, payload.offsetX, payload.offsetY, payload.gridColumns, payload.includeIds, payload.maxReturnedIds);
                break;
            case 'batch_rename':
                result = await batchRename(payload.nodeIds, payload.pattern, payload.startIndex);
                break;
            case 'batch_delete':
                result = await batchDelete(payload.nodeIds, payload.confirm);
                break;
            // Component System
            case 'create_component_from_nodes':
                result = await createComponentFromNodes(payload.nodeIds, payload.name, payload.organize);
                break;
            case 'create_variant_set':
                result = await createVariantSet(payload.componentIds, payload.propertyName, payload.propertyValues);
                break;
            case 'auto_create_variants':
                result = await autoCreateVariants(payload.componentId, payload.detectProperties);
                break;
            case 'merge_to_component':
                result = await mergeToComponent(payload.nodeIds, payload.smartMatch);
                break;
            case 'detach_instance':
                result = await detachInstance(payload.instanceIds, payload.deleteMainComponent);
                break;
            case 'swap_component':
                result = await swapComponent(payload.instanceIds, payload.newComponentKey, payload.preserveOverrides);
                break;
            // Prototype System
            case 'create_interaction':
                result = await createInteraction(payload.fromNodeId, payload.toNodeId, payload.trigger, payload.action);
                break;
            case 'batch_connect':
                result = await batchConnect(payload.connections);
                break;
            case 'copy_prototype':
                result = await copyPrototype(payload.sourceNodeId, payload.targetNodeIds, payload.adjustTargets);
                break;
            case 'create_flow':
                result = await createFlow(payload.startFrameId, payload.name, payload.description);
                break;
            // Style System
            case 'create_color_style':
                result = await createColorStyle(payload.name, payload.color, payload.sourceNodeId);
                break;
            case 'create_text_style':
                result = await createTextStyle(payload.name, payload.sourceNodeId);
                break;
            case 'apply_style_to_nodes':
                result = await applyStyleToNodes(payload.styleId, payload.nodeIds);
                break;
            case 'sync_styles_to_library':
                result = await syncStylesToLibrary(payload.styleIds, payload.libraryFileKey);
                break;
            case 'apply_style_preset':
                result = await applyStylePreset(payload.nodeIds, payload.preset, payload.options);
                break;
            // Intelligence
            case 'analyze_duplicates':
                result = await analyzeDuplicates(payload.scope, payload.threshold, payload.minOccurrences, payload.pageIds, payload.pageNames, payload.maxGroups, payload.maxNodesPerGroup, payload.maxAnalyzedNodes);
                break;
            case 'suggest_component_structure':
                result = await suggestComponentStructure(payload.scope, payload.maxDepth, payload.pageIds, payload.pageNames);
                break;
            case 'generate_naming_scheme':
                result = await generateNamingScheme(payload.nodeIds, payload.convention);
                break;
            case 'check_consistency':
                result = await checkConsistency(payload.scope, payload.checks, payload.pageIds, payload.pageNames);
                break;
            // Utilities
            case 'get_document_info':
                result = await getDocumentInfo(payload.includeChildren, payload.maxDepth, payload.maxPages, payload.maxNodesPerPage, payload.maxChildrenPerNode);
                break;
            case 'get_node_info':
                result = await getNodeInfo(payload.nodeId, payload.includeChildren);
                break;
            case 'get_selection':
                result = await getSelection(payload.includeChildren);
                break;
            case 'set_multiple_text_contents':
                result = await setMultipleTextContents(payload.updates);
                break;
            case 'select_nodes':
                result = await selectNodes(payload.nodeIds, payload.append, payload.focus);
                break;
            case 'set_focus':
                result = await setFocus(payload.nodeIds, payload.nodeId, payload.x, payload.y, payload.zoom);
                break;
            case 'move_nodes':
                result = await moveNodes(payload.nodeIds, payload.deltaX, payload.deltaY);
                break;
            case 'set_node_position':
                result = await setNodePosition(payload.nodeId, payload.x, payload.y);
                break;
            case 'arrange_nodes':
                result = await arrangeNodes(payload.nodeIds, payload.layout, payload.columns, payload.spacingX, payload.spacingY, payload.groupBy, payload.startX, payload.startY, payload.withinContainerId, payload.placementPolicy, payload.avoidOverlaps, payload.verifyVisual, payload.snapshotMode, payload.snapshotScale, payload.focus);
                break;
            case 'containerize_nodes':
                result = await containerizeNodes(payload.nodeIds, payload.containerId);
                break;
            case 'validate_structure':
                result = await validateStructure(payload.nodeIds, payload.containerId);
                break;
            case 'capture_view':
                result = await captureView(payload.mode, payload.nodeIds, payload.x, payload.y, payload.width, payload.height, payload.scale, payload.includeBase64, payload.maxBase64Length);
                break;
            case 'undo_operations':
                result = await undoOperations(payload.operationId, payload.steps);
                break;
            // NEW: Frame to Components
            case 'frame_to_components':
                result = await frameToComponents(payload.frameId, payload.strategy, payload.groupSimilar, payload.createVariants, payload.organizeOnPage, payload.minSize, payload.excludeTypes);
                break;
            case 'analyze_frame_structure':
                result = await analyzeFrameStructure(payload.frameId, payload.detectDuplicates, payload.minSimilarity);
                break;
            // NEW: Cross-Page Operations
            case 'cross_page_copy':
                result = await crossPageCopy(payload.nodeIds, payload.sourcePageId, payload.targetPageId, payload.maintainPosition);
                break;
            case 'cross_page_move':
                result = await crossPageMove(payload.nodeIds, payload.sourcePageId, payload.targetPageId, payload.maintainPosition);
                break;
            case 'batch_edit_across_pages':
                result = await batchEditAcrossPages(payload.operations);
                break;
            // NEW: Component Set Management
            case 'explode_component_set':
                result = await explodeComponentSet(payload.componentSetId, payload.convertInstancesToMain, payload.organizeOnPage);
                break;
            case 'detach_and_organize':
                result = await detachAndOrganize(payload.instanceIds, payload.deleteMainComponent, payload.organizeBy, payload.createBackup);
                break;
            case 'convert_instances_to_components':
                result = await convertInstancesToComponents(payload.instanceIds, payload.namingPattern, payload.organizeOnPage);
                break;
            case 'split_component_by_variants':
                result = await splitComponentByVariants(payload.componentSetId, payload.keepComponentSet, payload.updateInstances);
                break;
            case 'merge_components_to_set':
                result = await mergeComponentsToSet(payload.componentIds, payload.variantProperty, payload.autoDetectValues);
                break;
            // ===== Basic Node Creation =====
            case 'create_ellipse':
                result = await createEllipse(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_line':
                result = await createLine(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_polygon':
                result = await createPolygon(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_star':
                result = await createStar(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_vector':
                result = await createVector(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_group':
                result = await createGroup(payload.nodeIds, payload.name, payload.parentId);
                break;
            case 'create_section':
                result = await createSection(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_slice':
                result = await createSlice(payload.x, payload.y, payload.width, payload.height, payload.name);
                break;
            case 'create_connector':
                result = await createConnector(payload.startNodeId, payload.endNodeId, payload);
                break;
            case 'create_sticky':
                result = await createSticky(payload.x, payload.y, payload.text, payload.color, payload.parentId);
                break;
            case 'create_shape_with_text':
                result = await createShapeWithText(payload.x, payload.y, payload.width, payload.height, payload);
                break;
            case 'create_table':
                result = await createTable(payload.x, payload.y, payload.rowCount, payload.columnCount, payload);
                break;
            // ===== Boolean Operations =====
            case 'union_nodes':
                result = await booleanOperation(payload.nodeIds, 'UNION', payload.name, payload.parentId);
                break;
            case 'subtract_nodes':
                result = await booleanOperation(payload.nodeIds, 'SUBTRACT', payload.name, payload.parentId);
                break;
            case 'intersect_nodes':
                result = await booleanOperation(payload.nodeIds, 'INTERSECT', payload.name, payload.parentId);
                break;
            case 'exclude_nodes':
                result = await booleanOperation(payload.nodeIds, 'EXCLUDE', payload.name, payload.parentId);
                break;
            case 'flatten_nodes':
                result = await flattenNodes(payload.nodeIds, payload.parentId);
                break;
            // ===== Node Properties =====
            case 'set_constraints':
                result = await setConstraints(payload.nodeId, payload.horizontal, payload.vertical);
                break;
            case 'set_layout_grid':
                result = await setLayoutGrid(payload.nodeId, payload.layoutGrids);
                break;
            case 'set_effects':
                result = await setEffects(payload.nodeId, payload.effects);
                break;
            case 'set_export_settings':
                result = await setExportSettings(payload.nodeId, payload.exportSettings);
                break;
            case 'set_blend_mode':
                result = await setBlendMode(payload.nodeId, payload.blendMode);
                break;
            case 'set_mask':
                result = await setMask(payload.nodeId, payload.isMask, payload.maskType);
                break;
            // ===== Auto Layout =====
            case 'set_auto_layout':
                result = await setAutoLayout(payload.nodeId, payload);
                break;
            case 'remove_auto_layout':
                result = await removeAutoLayout(payload.nodeId, payload.keepPosition);
                break;
            case 'align_nodes':
                result = await alignNodes(payload.nodeIds, payload.alignment);
                break;
            case 'distribute_nodes':
                result = await distributeNodes(payload.nodeIds, payload.direction, payload.spacing);
                break;
            // ===== Styles =====
            case 'create_effect_style':
                result = await createEffectStyle(payload.name, payload.effects, payload.sourceNodeId);
                break;
            case 'create_grid_style':
                result = await createGridStyle(payload.name, payload.layoutGrids, payload.sourceNodeId);
                break;
            case 'update_paint_style':
                result = await updatePaintStyle(payload.styleId, payload.name, payload.paints);
                break;
            case 'update_text_style':
                result = await updateTextStyle(payload.styleId, payload);
                break;
            case 'delete_style':
                result = await deleteStyle(payload.styleId, payload.detachNodes);
                break;
            case 'get_all_styles':
                result = await getAllStyles(payload.type);
                break;
            // ===== Variables =====
            case 'create_variable':
                result = await createVariable(payload.name, payload.type, payload.value, payload.collectionId);
                break;
            case 'create_variable_collection':
                result = await createVariableCollection(payload.name, payload.modes);
                break;
            case 'set_variable_value':
                result = await setVariableValue(payload.variableId, payload.modeId, payload.value);
                break;
            case 'bind_variable_to_node':
                result = await bindVariableToNode(payload.nodeId, payload.variableId, payload.property);
                break;
            case 'unbind_variable':
                result = await unbindVariable(payload.nodeId, payload.property);
                break;
            case 'get_all_variables':
                result = await getAllVariables();
                break;
            case 'delete_variable':
                result = await deleteVariable(payload.variableId, payload.unbindNodes);
                break;
            // ===== Page Management =====
            case 'create_page':
                result = await createPage(payload.name, payload.index);
                break;
            case 'delete_page':
                result = await deletePage(payload.pageId, payload.confirm);
                break;
            case 'rename_page':
                result = await renamePage(payload.pageId, payload.newName);
                break;
            case 'reorder_pages':
                result = await reorderPages(payload.pageIds);
                break;
            case 'duplicate_page':
                result = await duplicatePage(payload.pageId, payload.newName);
                break;
            // ===== Media & Export =====
            case 'create_image_fill':
                result = await createImageFill(payload.url, payload.hash, payload.nodeId);
                break;
            case 'export_node':
                result = await exportNode(payload.nodeId, payload.format, payload.scale, payload.suffix);
                break;
            case 'export_nodes_batch':
                result = await exportNodesBatch(payload.exports);
                break;
            // ===== Component Properties =====
            case 'add_component_property':
                result = await addComponentProperty(payload.componentId, payload.name, payload.type, payload.defaultValue);
                break;
            case 'set_component_property':
                result = await setComponentProperty(payload.instanceId, payload.propertyName, payload.value);
                break;
            case 'remove_component_property':
                result = await removeComponentProperty(payload.componentId, payload.propertyName);
                break;
            // ===== Transform =====
            case 'scale_nodes':
                result = await scaleNodes(payload.nodeIds, payload.scaleX, payload.scaleY, payload.center);
                break;
            case 'flip_horizontal':
                result = await flipNodes(payload.nodeIds, 'horizontal');
                break;
            case 'flip_vertical':
                result = await flipNodes(payload.nodeIds, 'vertical');
                break;
            // ===== Advanced Import =====
            case 'load_component_from_file':
                result = await loadComponentFromFile(payload.fileKey, payload.componentKey);
                break;
            case 'load_style_from_file':
                result = await loadStyleFromFile(payload.fileKey, payload.styleKey);
                break;
            default:
                throw new Error(`Unknown tool: ${type}`);
        }
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error executing ${type}:`, error);
        throw error;
    }
}
// ===== Smart Discovery Implementation =====
async function smartSelect(query, scope = 'document', limit = 100, pageIds, pageNames) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const results = [];
    // Parse natural language query
    const queryLower = query.toLowerCase();
    const isButtonQuery = queryLower.includes('button') || queryLower.includes('按钮');
    const isCardQuery = queryLower.includes('card') || queryLower.includes('卡片');
    const isInputQuery = queryLower.includes('input') || queryLower.includes('text field') || queryLower.includes('输入');
    const isHeaderQuery = queryLower.includes('header') || queryLower.includes('导航') || queryLower.includes('nav');
    const wantsFrames = queryLower.includes('frame') || queryLower.includes('frames') || queryLower.includes('画板') || queryLower.includes('框');
    const wantsComponents = queryLower.includes('component') || queryLower.includes('components') || queryLower.includes('组件');
    const wantsInstances = queryLower.includes('instance') || queryLower.includes('instances') || queryLower.includes('实例');
    const wantsText = queryLower.includes('text') || queryLower.includes('文本');
    const colorMatch = queryLower.match(/(red|blue|green|yellow|black|white|红色|蓝色|绿色|黄色|黑色|白色)/);
    const nameMatch = queryLower.match(/["'](.+?)["']/);
    for (const root of roots) {
        await traverseNodes(root, async (node) => {
            if (results.length >= limit)
                return false;
            let score = 0;
            // Name-based matching
            if (nameMatch && node.name.toLowerCase().includes(nameMatch[1].toLowerCase())) {
                score += 10;
            }
            // Type-based matching
            if (isButtonQuery && (isButtonLike(node) || node.name.toLowerCase().includes('button'))) {
                score += 8;
            }
            if (isCardQuery && (isCardLike(node) || node.name.toLowerCase().includes('card'))) {
                score += 8;
            }
            if (isInputQuery && (isInputLike(node) || node.name.toLowerCase().includes('input'))) {
                score += 8;
            }
            if (isHeaderQuery && node.name.toLowerCase().includes('header')) {
                score += 8;
            }
            if (wantsFrames && node.type === 'FRAME')
                score += 8;
            if (wantsComponents && node.type === 'COMPONENT')
                score += 8;
            if (wantsInstances && node.type === 'INSTANCE')
                score += 8;
            if (wantsText && node.type === 'TEXT')
                score += 8;
            // Color matching
            if (colorMatch && 'fills' in node) {
                const fills = node.fills;
                if (fills && fills.length > 0 && fills[0].type === 'SOLID') {
                    const color = fills[0].color;
                    if (matchesColorQuery(color, colorMatch[1])) {
                        score += 5;
                    }
                }
            }
            if (score > 3) {
                results.push(node);
            }
            return true;
        });
        if (results.length >= limit)
            break;
    }
    const infos = [];
    let skipped = 0;
    for (const node of results) {
        try {
            infos.push(nodeToInfo(node));
        }
        catch (_a) {
            skipped += 1;
        }
    }
    if (skipped > 0) {
        bridgeLog(`smart_select skipped ${skipped} nodes due to info extraction errors`, 'warning');
    }
    return infos;
}
async function findSimilar(targetId, threshold = 0.85, scope = 'document', pageIds, pageNames) {
    const target = await figma.getNodeByIdAsync(targetId);
    if (!target)
        throw new Error('Target node not found');
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const results = [];
    const targetFeatures = extractFeatures(target);
    for (const root of roots) {
        await traverseNodes(root, async (node) => {
            if (node.id === targetId)
                return true;
            const similarity = calculateSimilarity(targetFeatures, extractFeatures(node));
            if (similarity >= threshold) {
                results.push({ node, similarity });
            }
            return true;
        });
    }
    return results
        .sort((a, b) => b.similarity - a.similarity)
        .map(r => (Object.assign(Object.assign({}, nodeToInfo(r.node)), { similarity: r.similarity })));
}
async function scanByPattern(pattern, scope = 'document', pageIds, pageNames, limit = 200) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const results = [];
    const maxResults = Math.max(1, Math.min(5000, Number.isFinite(limit) ? Math.floor(limit) : 200));
    let totalMatched = 0;
    let stop = false;
    for (const root of roots) {
        if (stop)
            break;
        await traverseNodes(root, async (node) => {
            if (stop)
                return false;
            let match = true;
            if (pattern.nameRegex && !new RegExp(pattern.nameRegex, 'i').test(node.name)) {
                match = false;
            }
            if (pattern.types && !pattern.types.includes(node.type)) {
                match = false;
            }
            if ('width' in node) {
                if (pattern.minWidth && node.width < pattern.minWidth)
                    match = false;
                if (pattern.maxWidth && node.width > pattern.maxWidth)
                    match = false;
                if (pattern.minHeight && node.height < pattern.minHeight)
                    match = false;
                if (pattern.maxHeight && node.height > pattern.maxHeight)
                    match = false;
            }
            if (pattern.hasAutoLayout && 'layoutMode' in node) {
                if (pattern.hasAutoLayout && node.layoutMode === 'NONE')
                    match = false;
            }
            if (match) {
                totalMatched += 1;
                if (results.length < maxResults) {
                    results.push(node);
                }
                else {
                    stop = true;
                    return false;
                }
            }
            return true;
        });
    }
    const nodes = [];
    let skippedDueToErrors = 0;
    for (const node of results) {
        try {
            nodes.push(nodeToInfo(node));
        }
        catch (_a) {
            skippedDueToErrors += 1;
        }
    }
    return {
        nodes,
        totalMatched,
        returned: nodes.length,
        truncated: totalMatched > results.length,
        limit: maxResults,
        skippedDueToErrors,
    };
}
async function autoDiscoverComponents(minSimilarity = 0.9, minOccurrences = 3, scope = 'page', pageIds, pageNames) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const allNodes = [];
    for (const root of roots) {
        await traverseNodes(root, async (node) => {
            if ('width' in node && node.width > 50 && node.height > 30) {
                allNodes.push(node);
            }
            return true;
        });
    }
    // Group similar nodes
    const groups = [];
    for (const node of allNodes) {
        const features = extractFeatures(node);
        let added = false;
        for (const group of groups) {
            if (calculateSimilarity(features, group.features) >= minSimilarity) {
                group.nodes.push(node);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push({ nodes: [node], features });
        }
    }
    // Filter groups with enough occurrences
    const candidates = groups
        .filter(g => g.nodes.length >= minOccurrences)
        .map(g => ({
        count: g.nodes.length,
        nodes: g.nodes.map(n => ({ id: n.id, name: n.name })),
        suggestedName: generateComponentName(g.nodes[0]),
    }));
    return {
        candidates,
        totalAnalyzed: allNodes.length,
    };
}
// ===== Batch Operations Implementation =====
async function batchCreate(operations, chunkSize = 50, continueOnError = true) {
    const results = [];
    const errors = [];
    const createdNodes = [];
    for (let i = 0; i < operations.length; i += chunkSize) {
        const chunk = operations.slice(i, i + chunkSize);
        // Report progress
        sendProgress('batch_create', i, operations.length, `Creating ${i + chunk.length}/${operations.length}`);
        for (const op of chunk) {
            try {
                const normalizeCreateType = (rawType) => {
                    const raw = String(rawType || '').trim();
                    if (!raw)
                        return '';
                    // Accept camelCase/PascalCase/snake/kebab and normalize to snake style.
                    const snake = raw
                        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
                        .replace(/[\s\-]+/g, '_')
                        .toLowerCase();
                    // Support both prefixed and plain forms, e.g. createEllipse / ellipse.
                    return snake.startsWith('create_') ? snake : `create_${snake}`;
                };
                const normalizedType = normalizeCreateType(op.type);
                const targetParentId = (op.params && typeof op.params.parentId === 'string')
                    ? op.params.parentId
                    : undefined;
                let node;
                switch (normalizedType) {
                    case 'create_rectangle':
                        node = figma.createRectangle();
                        break;
                    case 'create_frame':
                        node = figma.createFrame();
                        break;
                    case 'create_text':
                        node = figma.createText();
                        await figma.loadFontAsync(node.fontName);
                        break;
                    case 'create_component':
                        node = figma.createComponent();
                        break;
                    case 'create_ellipse':
                        node = figma.createEllipse();
                        break;
                    case 'create_line':
                        node = figma.createLine();
                        break;
                    case 'create_polygon':
                        node = figma.createPolygon();
                        break;
                    case 'create_star':
                        node = figma.createStar();
                        break;
                    case 'create_vector':
                        node = figma.createVector();
                        break;
                    default:
                        throw new Error(`Unknown create type: ${op.type}`);
                }
                // Apply params
                if (op.params) {
                    applyNodeProperties(node, op.params);
                }
                // Respect requested parent for all batch-created nodes (notably create_text).
                // Figma creates nodes on currentPage by default; appendToTargetParent reparents safely.
                await appendToTargetParent(node, targetParentId);
                createdNodes.push(node.id);
                results.push({ id: node.id, type: normalizedType });
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push({ operation: op, error: msg });
                if (!continueOnError)
                    throw error;
            }
        }
        // Yield to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return {
        success: results.length,
        failed: errors.length,
        createdIds: createdNodes,
        errors: errors.slice(0, 10),
    };
}
async function batchModify(operations, chunkSize = 50) {
    const results = [];
    const errors = [];
    for (let i = 0; i < operations.length; i += chunkSize) {
        const chunk = operations.slice(i, i + chunkSize);
        sendProgress('batch_modify', i, operations.length, `Modifying ${i + chunk.length}/${operations.length}`);
        for (const op of chunk) {
            try {
                const node = await figma.getNodeByIdAsync(op.nodeId);
                if (!node)
                    throw new Error('Node not found');
                applyNodeProperties(node, op.changes);
                results.push({ id: op.nodeId, success: true });
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push({ nodeId: op.nodeId, error: msg });
            }
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return {
        success: results.length,
        failed: errors.length,
        errors: errors.slice(0, 10),
    };
}
async function batchClone(templateId, count, offsetX = 200, offsetY = 0, gridColumns = 5, includeIds = false, maxReturnedIds = 100) {
    const template = await figma.getNodeByIdAsync(templateId);
    if (!template)
        throw new Error('Template not found');
    const templateParent = template.parent;
    if (!templateParent || !('appendChild' in templateParent)) {
        throw new Error('Template parent does not support children');
    }
    const clones = [];
    const baseX = 'x' in template ? template.x : 0;
    const baseY = 'y' in template ? template.y : 0;
    for (let i = 0; i < count; i++) {
        // Keep clones in the same parent/page as template to avoid accidental cross-page placement.
        // For components, generate instances instead of duplicating main components.
        let clone;
        if (template.type === 'COMPONENT') {
            clone = template.createInstance();
        }
        else if (template.type === 'COMPONENT_SET') {
            const variant = template.defaultVariant;
            if (!variant)
                throw new Error('Component set has no default variant');
            clone = variant.createInstance();
        }
        else {
            clone = template.clone();
        }
        const parent = templateParent;
        if (clone.parent !== parent)
            parent.appendChild(clone);
        // Start from the next grid slot so the first clone does not overlap the template.
        const slotIndex = i + 1;
        const col = slotIndex % gridColumns;
        const row = Math.floor(slotIndex / gridColumns);
        if ('x' in clone)
            clone.x = baseX + col * offsetX;
        if ('y' in clone)
            clone.y = baseY + row * offsetY;
        clones.push(clone.id);
        const processed = i + 1;
        if (processed % 50 === 0 || processed === count) {
            sendProgress('batch_clone', processed, count, `Cloning ${processed}/${count}`);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    if (!includeIds) {
        return { cloned: clones.length, idsIncluded: false, returnedIds: 0, truncated: false };
    }
    const maxIds = Math.max(0, Math.min(5000, Number.isFinite(maxReturnedIds) ? Math.floor(maxReturnedIds) : 100));
    const ids = clones.slice(0, maxIds);
    return {
        cloned: clones.length,
        idsIncluded: true,
        returnedIds: ids.length,
        truncated: clones.length > ids.length,
        ids,
    };
}
async function batchRename(nodeIds, pattern, startIndex = 1) {
    const results = [];
    for (let i = 0; i < nodeIds.length; i++) {
        const node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (node) {
            const newName = pattern.replace('{index}', String(startIndex + i));
            node.name = newName;
            results.push({ id: nodeIds[i], name: newName });
        }
    }
    return { renamed: results.length, names: results };
}
async function batchDelete(nodeIds, confirm = false) {
    var _a;
    if (!confirm && nodeIds.length > 10) {
        throw new Error(`Deleting ${nodeIds.length} nodes requires confirm=true`);
    }
    await figma.loadAllPagesAsync();
    let deleted = 0;
    const missing = [];
    const failed = [];
    const getContainingPage = (node) => {
        let cur = node;
        while (cur) {
            if (cur.type === 'PAGE')
                return cur;
            cur = cur.parent;
        }
        return null;
    };
    const isAttachedToDocument = (node) => {
        if (!node)
            return false;
        let cur = node;
        while (cur) {
            if (cur === figma.root)
                return true;
            cur = cur.parent;
        }
        return false;
    };
    const getDepth = (node) => {
        let depth = 0;
        let cur = node;
        while (cur && cur !== figma.root) {
            depth++;
            cur = cur.parent;
        }
        return depth;
    };
    // Deduplicate first to avoid repeated expensive lookups.
    const orderedIds = Array.from(new Set(nodeIds));
    const unresolved = new Set(orderedIds);
    const resolved = new Map();
    // Fast path via direct lookup.
    for (const id of orderedIds) {
        let node = (await figma.getNodeByIdAsync(id));
        if (!node) {
            try {
                node = figma.getNodeById(id);
            }
            catch (_b) {
                node = null;
            }
        }
        const page = getContainingPage(node);
        if (node && page) {
            resolved.set(id, { node, page });
            unresolved.delete(id);
        }
    }
    // Resolve remaining IDs by scanning each page once.
    if (unresolved.size > 0) {
        for (const page of figma.root.children) {
            if (unresolved.size === 0)
                break;
            if (typeof page.loadAsync === 'function') {
                await page.loadAsync();
            }
            const hits = page.findAll((n) => unresolved.has(n.id));
            for (const hit of hits) {
                if (!resolved.has(hit.id)) {
                    resolved.set(hit.id, { node: hit, page });
                    unresolved.delete(hit.id);
                }
            }
        }
    }
    for (const id of unresolved) {
        missing.push(id);
    }
    // If a parent is requested, don't delete its descendants individually.
    const requested = new Set(orderedIds);
    const implicitByAncestor = new Set();
    const deletableByPage = new Map();
    for (const id of orderedIds) {
        const item = resolved.get(id);
        if (!item)
            continue;
        let cur = item.node.parent;
        let covered = false;
        while (cur && cur !== figma.root) {
            if (requested.has(cur.id)) {
                covered = true;
                break;
            }
            cur = cur.parent;
        }
        if (covered) {
            implicitByAncestor.add(id);
            continue;
        }
        const bucket = deletableByPage.get(item.page.id) || [];
        bucket.push({ id, node: item.node, page: item.page });
        deletableByPage.set(item.page.id, bucket);
    }
    // Execute per page to avoid repeated page switches in large docs.
    const currentPage = figma.currentPage;
    const totalExplicitDeletes = Array.from(deletableByPage.values()).reduce((acc, arr) => acc + arr.length, 0);
    let processed = 0;
    for (const [, entries] of deletableByPage) {
        if (entries.length === 0)
            continue;
        const page = entries[0].page;
        if (figma.currentPage.id !== page.id) {
            await figma.setCurrentPageAsync(page);
        }
        if (typeof page.loadAsync === 'function') {
            await page.loadAsync();
        }
        // Delete deeper nodes first for deterministic behavior.
        entries.sort((a, b) => getDepth(b.node) - getDepth(a.node));
        for (const entry of entries) {
            const { id } = entry;
            processed++;
            if (processed % 100 === 0 || processed === totalExplicitDeletes) {
                sendProgress('batch_delete', processed, totalExplicitDeletes, `Deleting ${processed}/${totalExplicitDeletes}`);
            }
            try {
                const liveNode = (_a = (await figma.getNodeByIdAsync(id))) !== null && _a !== void 0 ? _a : figma.getNodeById(id);
                if (!liveNode || !isAttachedToDocument(liveNode)) {
                    deleted++;
                    continue;
                }
                // Components can fail when instances still exist.
                if (liveNode.type === 'COMPONENT') {
                    const componentNode = liveNode;
                    try {
                        const directInstances = await componentNode.getInstancesAsync();
                        for (const inst of directInstances) {
                            try {
                                inst.remove();
                            }
                            catch (_c) {
                                // best-effort
                            }
                        }
                    }
                    catch (_d) {
                        // keep going; deletion may still succeed
                    }
                }
                let removedBy = 'async-node';
                let removeError = '';
                try {
                    liveNode.remove();
                }
                catch (e) {
                    removeError = e instanceof Error ? e.message : String(e);
                }
                let remaining = (await figma.getNodeByIdAsync(id));
                if (remaining && !isAttachedToDocument(remaining)) {
                    remaining = null;
                }
                if (remaining && remaining.type === 'COMPONENT') {
                    try {
                        const parent = remaining.parent;
                        if (parent && 'children' in parent) {
                            const childRef = parent.children.find((c) => c.id === id);
                            childRef === null || childRef === void 0 ? void 0 : childRef.remove();
                            removedBy = 'parent-child-ref';
                        }
                    }
                    catch (_e) {
                        // fall through
                    }
                    remaining = (await figma.getNodeByIdAsync(id));
                    if (remaining && !isAttachedToDocument(remaining)) {
                        remaining = null;
                    }
                }
                if (remaining && remaining.type === 'COMPONENT') {
                    try {
                        const syncDelNode = figma.getNodeById(id);
                        syncDelNode === null || syncDelNode === void 0 ? void 0 : syncDelNode.remove();
                        removedBy = 'sync-node';
                    }
                    catch (_f) {
                        // keep verifying
                    }
                    remaining = (await figma.getNodeByIdAsync(id));
                    if (remaining && !isAttachedToDocument(remaining)) {
                        remaining = null;
                    }
                }
                if (remaining) {
                    const parentType = (() => {
                        var _a;
                        try {
                            return ((_a = remaining.parent) === null || _a === void 0 ? void 0 : _a.type) || 'unknown';
                        }
                        catch (_b) {
                            return 'unknown';
                        }
                    })();
                    failed.push({
                        id,
                        reason: `Node still exists after remove() [type=${remaining.type}, parent=${parentType}, removedBy=${removedBy}, removeError=${removeError || 'none'}]`,
                    });
                }
                else {
                    deleted++;
                }
            }
            catch (e) {
                failed.push({ id, reason: e instanceof Error ? e.message : String(e) });
            }
        }
    }
    // Requested descendants are considered deleted when their ancestor is deleted.
    deleted += implicitByAncestor.size;
    // Restore page for better UX.
    if (figma.currentPage.id !== currentPage.id) {
        await figma.setCurrentPageAsync(currentPage);
    }
    return { deleted, missing, failed };
}
// ===== Component System Implementation =====
async function createComponentFromNodes(nodeIds, name, organize = true) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    if (nodes.length === 0)
        throw new Error('No valid nodes found');
    // Create component from first node
    const mainNode = nodes[0];
    let component;
    if (mainNode.type === 'COMPONENT') {
        component = mainNode;
    }
    else {
        component = figma.createComponent();
        component.name = name || mainNode.name;
        // Copy properties
        if ('width' in mainNode) {
            component.resize(mainNode.width, mainNode.height);
        }
        if ('layoutMode' in mainNode) {
            const frame = mainNode;
            component.layoutMode = frame.layoutMode;
            component.primaryAxisAlignItems = frame.primaryAxisAlignItems;
            component.counterAxisAlignItems = frame.counterAxisAlignItems;
            component.paddingTop = frame.paddingTop;
            component.paddingRight = frame.paddingRight;
            component.paddingBottom = frame.paddingBottom;
            component.paddingLeft = frame.paddingLeft;
            component.itemSpacing = frame.itemSpacing;
        }
        // Clone children
        if ('children' in mainNode) {
            for (const child of mainNode.children) {
                const clone = child.clone();
                component.appendChild(clone);
            }
        }
        // Position near original
        if ('x' in mainNode && 'y' in mainNode) {
            component.x = mainNode.x + mainNode.width + 100;
            component.y = mainNode.y;
        }
        figma.currentPage.appendChild(component);
    }
    // Create instances for remaining nodes
    const instances = [];
    for (let i = 1; i < nodes.length; i++) {
        const instance = component.createInstance();
        const node = nodes[i];
        if ('x' in node && 'y' in node) {
            instance.x = node.x;
            instance.y = node.y;
        }
        if (node.parent) {
            node.parent.insertChild(node.parent.children.indexOf(node), instance);
        }
        node.remove();
        instances.push(instance.id);
    }
    // Organize on Components page if requested
    if (organize) {
        await figma.loadAllPagesAsync();
        let componentsPage = figma.root.children.find(p => p.name === 'Components');
        if (!componentsPage) {
            componentsPage = figma.createPage();
            componentsPage.name = 'Components';
        }
        componentsPage.appendChild(component);
    }
    return {
        componentId: component.id,
        componentName: component.name,
        instancesCreated: instances.length,
        instanceIds: instances,
    };
}
async function createVariantSet(componentIds, propertyName, propertyValues) {
    var _a;
    const components = [];
    for (const id of componentIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && node.type === 'COMPONENT') {
            components.push(node);
        }
    }
    if (components.length < 2) {
        throw new Error('Need at least 2 components to create variant set');
    }
    const parent = components[0].parent;
    if (!parent || !('appendChild' in parent)) {
        throw new Error('Components must be on a page/frame before creating variants');
    }
    for (const comp of components) {
        if (((_a = comp.parent) === null || _a === void 0 ? void 0 : _a.id) !== parent.id) {
            parent.appendChild(comp);
        }
    }
    for (let i = 0; i < components.length; i++) {
        const comp = components[i];
        const variantValue = propertyValues[i] || `Variant ${i + 1}`;
        comp.name = `${propertyName}=${variantValue}`;
    }
    const componentSet = combineComponentsAsVariants(components, parent);
    componentSet.name = components[0].name.replace(/\s*\d+$/, '');
    return {
        componentSetId: componentSet.id,
        name: componentSet.name,
        variants: components.length,
    };
}
function combineComponentsAsVariants(components, parent) {
    if (typeof figma.combineAsVariants === 'function') {
        return figma.combineAsVariants(components, parent);
    }
    // Fallback for environments where combineAsVariants is unavailable.
    const componentSet = figma.createComponentSet();
    parent.appendChild(componentSet);
    for (const comp of components) {
        componentSet.appendChild(comp);
    }
    return componentSet;
}
async function autoCreateVariants(componentId, detectProperties = ['fills', 'text', 'visibility']) {
    var _a;
    const component = await figma.getNodeByIdAsync(componentId);
    if (!component || component.type !== 'COMPONENT') {
        throw new Error('Valid component not found');
    }
    // Analyze component structure
    const variants = [];
    // Simple variant detection - create states
    if (detectProperties.includes('fills')) {
        variants.push({ name: 'State=Default', changes: {} }, { name: 'State=Hover', changes: { opacity: 0.8 } }, { name: 'State=Pressed', changes: { opacity: 0.6 } }, { name: 'State=Disabled', changes: { opacity: 0.4 } });
    }
    const parent = component.parent || figma.currentPage;
    const variantComponents = [];
    for (const variant of variants) {
        const variantComp = component.clone();
        variantComp.name = variant.name;
        if (variant.changes.opacity) {
            variantComp.opacity = variant.changes.opacity;
        }
        if (((_a = variantComp.parent) === null || _a === void 0 ? void 0 : _a.id) !== parent.id) {
            parent.appendChild(variantComp);
        }
        variantComponents.push(variantComp);
    }
    const componentSet = combineComponentsAsVariants(variantComponents, parent);
    componentSet.name = component.name;
    // Remove original component after variants are assembled
    component.remove();
    return {
        componentSetId: componentSet.id,
        variantsCreated: variants.length,
    };
}
async function mergeToComponent(nodeIds, smartMatch = true) {
    if (smartMatch) {
        // Group similar nodes
        const groups = await groupSimilarNodes(nodeIds);
        const results = [];
        for (const group of groups) {
            const result = await createComponentFromNodes(group, undefined, true);
            results.push(result);
        }
        return { merged: results.length, details: results };
    }
    else {
        return createComponentFromNodes(nodeIds);
    }
}
async function detachInstance(instanceIds, deleteMainComponent = false) {
    const detached = [];
    for (const id of instanceIds) {
        const instance = await figma.getNodeByIdAsync(id);
        if (instance && instance.type === 'INSTANCE') {
            const mainComponent = await getInstanceMainComponentSafe(instance);
            const detachedNode = instance.detachInstance();
            detached.push(detachedNode.id);
            if (deleteMainComponent && mainComponent) {
                mainComponent.remove();
            }
        }
    }
    return { detached: detached.length, ids: detached };
}
async function swapComponent(instanceIds, newComponentKey, preserveOverrides = true) {
    const swapped = [];
    // Get new component
    const newComponent = await figma.importComponentByKeyAsync(newComponentKey);
    for (const id of instanceIds) {
        const instance = await figma.getNodeByIdAsync(id);
        if (instance && instance.type === 'INSTANCE') {
            instance.swapComponent(newComponent);
            swapped.push(id);
        }
    }
    return { swapped: swapped.length, ids: swapped };
}
// ===== Prototype System Implementation =====
async function createInteraction(fromNodeId, toNodeId, trigger, action) {
    var _a, _b, _c;
    const fromNode = await figma.getNodeByIdAsync(fromNodeId);
    const toNode = await figma.getNodeByIdAsync(toNodeId);
    if (!fromNode)
        throw new Error('Source node not found');
    if (!toNode)
        throw new Error('Target node not found');
    if (typeof fromNode.setReactionsAsync !== 'function') {
        throw new Error('Source node does not support prototype reactions');
    }
    let effectiveFromNode = fromNode;
    let sourceParentType = (_a = effectiveFromNode === null || effectiveFromNode === void 0 ? void 0 : effectiveFromNode.parent) === null || _a === void 0 ? void 0 : _a.type;
    let sourceType = effectiveFromNode === null || effectiveFromNode === void 0 ? void 0 : effectiveFromNode.type;
    const validSourceTypes = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION']);
    if (!validSourceTypes.has(sourceType)) {
        throw new Error(`Invalid source node type for interaction: ${sourceType}. Expected one of FRAME | COMPONENT | INSTANCE | SECTION.`);
    }
    // Figma API currently behaves inconsistently for setting reactions directly on main COMPONENTs.
    // Auto-fallback: if source is COMPONENT, try the first instance on current page.
    if (sourceType === 'COMPONENT') {
        let firstInstance = null;
        await traverseNodes(figma.currentPage, async (node) => {
            if (node.type !== 'INSTANCE')
                return true;
            const main = await getInstanceMainComponentSafe(node);
            if (main && main.id === effectiveFromNode.id) {
                firstInstance = node;
                return false;
            }
            return true;
        });
        if (!firstInstance) {
            throw new Error('Source COMPONENT has no instance on current page. Create an instance and call create_interaction on the instance (or a frame).');
        }
        effectiveFromNode = firstInstance;
        sourceParentType = (_b = effectiveFromNode === null || effectiveFromNode === void 0 ? void 0 : effectiveFromNode.parent) === null || _b === void 0 ? void 0 : _b.type;
        sourceType = 'INSTANCE';
    }
    if (sourceParentType === 'PAGE' && sourceType !== 'FRAME') {
        throw new Error(`Invalid source node for interaction: top-level ${sourceType} cannot host reactions. Use a FRAME or a node inside a FRAME.`);
    }
    const destinationType = toNode === null || toNode === void 0 ? void 0 : toNode.type;
    const validDestTypes = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION']);
    if (!validDestTypes.has(destinationType)) {
        throw new Error(`Invalid destination node type: ${destinationType}. Expected one of FRAME | COMPONENT | INSTANCE | SECTION.`);
    }
    const getPageId = (node) => {
        let cur = node;
        while (cur) {
            if (cur.type === 'PAGE')
                return cur.id;
            cur = cur.parent;
        }
        return null;
    };
    const fromPageId = getPageId(effectiveFromNode);
    const toPageId = getPageId(toNode);
    if (fromPageId && toPageId && fromPageId !== toPageId) {
        throw new Error(`Cross-page interaction is not supported by Figma reactions: source page ${fromPageId}, target page ${toPageId}.`);
    }
    const normalizeTrigger = (raw) => {
        if (raw == null) {
            return { type: 'ON_CLICK' };
        }
        const type = String((raw === null || raw === void 0 ? void 0 : raw.type) || '').toUpperCase();
        if (!type) {
            throw new Error('Trigger type is required when trigger object is provided');
        }
        const delay = Number.isFinite(raw === null || raw === void 0 ? void 0 : raw.delay) ? Number(raw.delay) : 0;
        const timeout = Number.isFinite(raw === null || raw === void 0 ? void 0 : raw.timeout) ? Number(raw.timeout) : 0.3;
        if (type === 'AFTER_TIMEOUT') {
            return { type: 'AFTER_TIMEOUT', timeout: Math.max(0, timeout) };
        }
        if (type === 'ON_CLICK')
            return { type: 'ON_CLICK' };
        if (type === 'MOUSE_UP' || type === 'MOUSE_DOWN') {
            return { type: type, delay: Math.max(0, delay) };
        }
        if (type === 'MOUSE_ENTER' || type === 'MOUSE_LEAVE') {
            // Figma rejects legacy trigger keys like deprecatedVersion in setReactionsAsync.
            return {
                type: type,
                delay: Math.max(0, delay),
            };
        }
        if (type === 'ON_DRAG') {
            throw new Error('Trigger ON_DRAG is currently unsupported in this MCP. Use ON_CLICK/ON_HOVER/ON_PRESS or MOUSE/AFTER_TIMEOUT triggers.');
        }
        if (type === 'ON_HOVER')
            return { type: 'ON_HOVER' };
        if (type === 'ON_PRESS')
            return { type: 'ON_PRESS' };
        if (type === 'ON_MEDIA_END')
            return { type: 'ON_MEDIA_END' };
        if (type === 'ON_KEY_DOWN' || type === 'ON_KEY_UP') {
            throw new Error(`Trigger ${type} is not supported by current Figma reactions schema`);
        }
        throw new Error(`Unsupported trigger type: ${type}`);
    };
    const normalizeEasing = (raw) => {
        if (raw == null)
            return { type: 'EASE_OUT' };
        const type = typeof raw === 'string' ? raw : raw === null || raw === void 0 ? void 0 : raw.type;
        const upperRaw = String(type || 'EASE_OUT').toUpperCase();
        // Accept common aliases used by LLM/tool callers.
        const aliasMap = {
            EASE_IN_OUT: 'EASE_IN_AND_OUT',
            EASE_INOUT: 'EASE_IN_AND_OUT',
            EASE_OUT_IN: 'EASE_IN_AND_OUT',
        };
        const upper = aliasMap[upperRaw] || upperRaw;
        if ([
            'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'LINEAR',
            'EASE_IN_BACK', 'EASE_OUT_BACK', 'EASE_IN_AND_OUT_BACK',
            'GENTLE', 'QUICK', 'BOUNCY', 'SLOW',
        ].includes(upper)) {
            return { type: upper };
        }
        throw new Error(`Unsupported easing type: ${upper}`);
    };
    const normalizeTransition = (raw) => {
        var _a;
        // Only parse explicit transition/animation blocks.
        // Do not treat the whole action object as a transition source.
        const source = (raw === null || raw === void 0 ? void 0 : raw.transition) || (raw === null || raw === void 0 ? void 0 : raw.animation);
        if (!source || typeof source !== 'object')
            return null;
        const transitionType = String((source === null || source === void 0 ? void 0 : source.type) || 'DISSOLVE').toUpperCase();
        const duration = Number.isFinite(source === null || source === void 0 ? void 0 : source.duration) ? Number(source.duration) : 0.3;
        const easing = normalizeEasing(source === null || source === void 0 ? void 0 : source.easing);
        if (['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'].includes(transitionType)) {
            const direction = String((source === null || source === void 0 ? void 0 : source.direction) || 'RIGHT').toUpperCase();
            return {
                type: transitionType,
                direction: ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(direction) ? direction : 'RIGHT',
                matchLayers: Boolean((_a = source === null || source === void 0 ? void 0 : source.matchLayers) !== null && _a !== void 0 ? _a : false),
                easing,
                duration,
            };
        }
        if (['DISSOLVE', 'SMART_ANIMATE', 'SCROLL_ANIMATE'].includes(transitionType)) {
            return {
                type: transitionType,
                easing,
                duration,
            };
        }
        throw new Error(`Unsupported transition type: ${transitionType}`);
    };
    const normalizeNodeAction = (rawAction, fallbackDestinationId) => {
        var _a;
        const rawType = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.type) || 'NODE').toUpperCase();
        if (rawType === 'BACK' || rawType === 'CLOSE') {
            return { type: rawType };
        }
        if (rawType === 'URL' || rawType === 'OPEN_LINK') {
            const url = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.url) || (rawAction === null || rawAction === void 0 ? void 0 : rawAction.href) || '').trim();
            if (!url)
                throw new Error('URL action requires url');
            return { type: 'URL', url, openInNewTab: Boolean((_a = rawAction === null || rawAction === void 0 ? void 0 : rawAction.openInNewTab) !== null && _a !== void 0 ? _a : true) };
        }
        if (rawType !== 'NODE') {
            throw new Error(`Unsupported action.type: ${rawType}. Supported: NODE | BACK | CLOSE | URL`);
        }
        const navigationCandidate = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.navigation) || 'NAVIGATE').toUpperCase();
        if (!['NAVIGATE', 'OVERLAY', 'SWAP', 'SCROLL_TO', 'CHANGE_TO'].includes(navigationCandidate)) {
            throw new Error(`Unsupported navigation: ${navigationCandidate}`);
        }
        const navigation = navigationCandidate;
        const destinationId = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.destinationId) || fallbackDestinationId || '');
        if (!destinationId)
            throw new Error('NODE action requires destinationId (or toNodeId)');
        const transition = normalizeTransition(rawAction) || {
            type: 'DISSOLVE',
            easing: { type: 'EASE_OUT' },
            duration: 0.3,
        };
        const nodeAction = {
            type: 'NODE',
            destinationId,
            navigation: navigation,
        };
        nodeAction.transition = transition;
        // Only pass optional keys when caller explicitly provided them.
        // Some Figma runtime versions reject unknown/extra keys in Action.
        if (rawAction && Object.prototype.hasOwnProperty.call(rawAction, 'preserveScrollPosition')) {
            nodeAction.preserveScrollPosition = Boolean(rawAction.preserveScrollPosition);
        }
        if (rawAction && Object.prototype.hasOwnProperty.call(rawAction, 'resetScrollPosition')) {
            nodeAction.resetScrollPosition = Boolean(rawAction.resetScrollPosition);
        }
        if (rawAction && Object.prototype.hasOwnProperty.call(rawAction, 'resetVideoPosition')) {
            nodeAction.resetVideoPosition = Boolean(rawAction.resetVideoPosition);
        }
        if (rawAction && Object.prototype.hasOwnProperty.call(rawAction, 'resetInteractiveComponents')) {
            nodeAction.resetInteractiveComponents = Boolean(rawAction.resetInteractiveComponents);
        }
        if (rawAction === null || rawAction === void 0 ? void 0 : rawAction.overlayRelativePosition) {
            nodeAction.overlayRelativePosition = rawAction.overlayRelativePosition;
        }
        return nodeAction;
    };
    const normalizedTrigger = normalizeTrigger(trigger);
    const normalizedAction = normalizeNodeAction(action || {}, toNodeId);
    const currentReactions = ('reactions' in effectiveFromNode ? (effectiveFromNode.reactions || []) : []);
    const normalizedCurrent = (currentReactions || [])
        .map((r) => ({
        trigger: normalizeTrigger(r === null || r === void 0 ? void 0 : r.trigger),
        actions: Array.isArray(r === null || r === void 0 ? void 0 : r.actions) ? r.actions : ((r === null || r === void 0 ? void 0 : r.action) ? [r.action] : []),
    }))
        .filter((r) => (r === null || r === void 0 ? void 0 : r.trigger) && Array.isArray(r === null || r === void 0 ? void 0 : r.actions) && r.actions.length > 0);
    const candidates = [
        { trigger: normalizedTrigger, action: normalizedAction, actions: [normalizedAction] },
        { trigger: normalizedTrigger, action: normalizedAction },
        { trigger: normalizedTrigger, actions: [normalizedAction] },
    ];
    const failures = [];
    let appliedReaction = null;
    for (const candidate of candidates) {
        try {
            await effectiveFromNode.setReactionsAsync([...(normalizedCurrent || []), candidate]);
            appliedReaction = candidate;
            break;
        }
        catch (e1) {
            failures.push(`append failed: ${(e1 === null || e1 === void 0 ? void 0 : e1.message) || String(e1)}`);
            try {
                // Retry without existing reactions in case legacy reactions are malformed.
                await effectiveFromNode.setReactionsAsync([candidate]);
                appliedReaction = candidate;
                break;
            }
            catch (e2) {
                failures.push(`replace failed: ${(e2 === null || e2 === void 0 ? void 0 : e2.message) || String(e2)}`);
            }
        }
    }
    if (!appliedReaction) {
        throw new Error(`Failed to create interaction. Attempts: ${failures.join(' | ')}`);
    }
    return {
        fromNodeId: effectiveFromNode.id,
        requestedFromNodeId: fromNodeId,
        toNodeId,
        requestedTrigger: trigger || null,
        trigger: appliedReaction.trigger,
        action: ((_c = appliedReaction.actions) === null || _c === void 0 ? void 0 : _c[0]) || appliedReaction.action || null,
        downgradedTrigger: false,
        downgradeReason: null,
    };
}
async function batchConnect(connections) {
    const results = [];
    const errors = [];
    for (const conn of connections) {
        try {
            const result = await createInteraction(conn.fromNodeId, conn.toNodeId, conn.trigger, conn.action);
            results.push(result);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push({ connection: conn, error: msg });
        }
    }
    return {
        created: results.length,
        failed: errors.length,
        errors: errors.slice(0, 10),
    };
}
async function copyPrototype(sourceNodeId, targetNodeIds, adjustTargets = true) {
    const sourceNode = await figma.getNodeByIdAsync(sourceNodeId);
    if (!sourceNode)
        throw new Error('Source node not found');
    const reactions = ('reactions' in sourceNode ? (sourceNode.reactions || []) : []);
    const copied = new Set();
    let interactionsCreated = 0;
    const skippedActions = [];
    for (const targetId of targetNodeIds) {
        const targetNode = await figma.getNodeByIdAsync(targetId);
        if (!targetNode)
            continue;
        for (const r of reactions) {
            const actions = Array.isArray(r.actions)
                ? r.actions
                : (r.action ? [r.action] : []);
            for (const rawAction of actions) {
                const actionType = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.type) || '').toUpperCase();
                if (actionType !== 'NODE') {
                    skippedActions.push({
                        targetId,
                        reason: 'Only NODE prototype actions are supported in copy_prototype',
                        actionType: actionType || 'UNKNOWN',
                    });
                    continue;
                }
                let destinationId = String((rawAction === null || rawAction === void 0 ? void 0 : rawAction.destinationId) || '');
                if (!destinationId) {
                    skippedActions.push({ targetId, reason: 'NODE action missing destinationId', actionType: actionType || 'NODE' });
                    continue;
                }
                if (adjustTargets) {
                    const destNode = await figma.getNodeByIdAsync(destinationId);
                    if (destNode) {
                        const similarNode = await findNodeWithSimilarName(figma.currentPage, targetNode.name, destNode.name);
                        if (similarNode)
                            destinationId = similarNode.id;
                    }
                }
                if (destinationId === targetId) {
                    skippedActions.push({
                        targetId,
                        reason: 'Skipped self-referencing interaction after destination mapping',
                        actionType: actionType || 'NODE',
                    });
                    continue;
                }
                try {
                    await createInteraction(targetId, destinationId, r.trigger || { type: 'ON_CLICK' }, Object.assign(Object.assign({}, rawAction), { type: 'NODE', destinationId }));
                    copied.add(targetId);
                    interactionsCreated++;
                }
                catch (e) {
                    skippedActions.push({
                        targetId,
                        reason: e instanceof Error ? e.message : String(e),
                        actionType: actionType || 'NODE',
                    });
                }
            }
        }
    }
    return { copied: copied.size, ids: Array.from(copied), interactionsCreated, skippedActions };
}
async function createFlow(startFrameId, name, description) {
    const frame = await figma.getNodeByIdAsync(startFrameId);
    if (!frame)
        throw new Error('Frame not found');
    // In Figma, flows are created via the prototype panel
    // We'll create a flow starting point
    frame.name = `🚀 ${name}`;
    return {
        frameId: startFrameId,
        flowName: name,
        description,
    };
}
// ===== Style System Implementation =====
async function createColorStyle(name, color, sourceNodeId) {
    var _a;
    let paint;
    if (sourceNodeId) {
        const node = await figma.getNodeByIdAsync(sourceNodeId);
        if (!node || !('fills' in node)) {
            throw new Error('Source node not found or has no fills');
        }
        const fills = node.fills;
        const solidFill = fills.find(f => f.type === 'SOLID');
        if (!solidFill)
            throw new Error('No solid fill found');
        paint = solidFill;
    }
    else if (color) {
        const toUnit = (value) => {
            const n = Number(value);
            if (!Number.isFinite(n))
                return 0;
            const normalized = n > 1 ? n / 255 : n;
            return Math.max(0, Math.min(1, normalized));
        };
        paint = {
            type: 'SOLID',
            color: { r: toUnit(color.r), g: toUnit(color.g), b: toUnit(color.b) },
            opacity: toUnit((_a = color.a) !== null && _a !== void 0 ? _a : 1),
        };
    }
    else {
        throw new Error('Either color or sourceNodeId required');
    }
    const style = figma.createPaintStyle();
    style.name = name;
    style.paints = [paint];
    return {
        styleId: style.id,
        name: style.name,
        color: paint.color,
    };
}
async function createTextStyle(name, sourceNodeId) {
    const node = await figma.getNodeByIdAsync(sourceNodeId);
    if (!node || node.type !== 'TEXT') {
        throw new Error('Text node not found');
    }
    if (node.fontName === figma.mixed) {
        throw new Error('Text node has mixed fonts. Use a single-font text node for create_text_style.');
    }
    await figma.loadFontAsync(node.fontName);
    const style = figma.createTextStyle();
    style.name = name;
    style.fontName = node.fontName;
    style.fontSize = node.fontSize;
    style.letterSpacing = node.letterSpacing;
    style.lineHeight = node.lineHeight;
    style.paragraphIndent = node.paragraphIndent;
    style.paragraphSpacing = node.paragraphSpacing;
    style.textCase = node.textCase;
    style.textDecoration = node.textDecoration;
    return {
        styleId: style.id,
        name: style.name,
    };
}
async function applyStyleToNodes(styleId, nodeIds) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style)
        throw new Error('Style not found');
    const applied = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node)
            continue;
        if (style.type === 'PAINT' && 'fillStyleId' in node) {
            await node.setFillStyleIdAsync(styleId);
            applied.push(id);
        }
        else if (style.type === 'TEXT' && node.type === 'TEXT') {
            await node.setTextStyleIdAsync(styleId);
            applied.push(id);
        }
    }
    return { applied: applied.length, ids: applied };
}
async function syncStylesToLibrary(styleIds, libraryFileKey) {
    // Note: Publishing to team library requires user interaction in Figma
    // We'll prepare the styles for publishing
    const styleResults = await Promise.all(styleIds.map(id => figma.getStyleByIdAsync(id)));
    const styles = styleResults.filter(Boolean);
    return {
        prepared: styles.length,
        note: 'Please publish styles manually in Figma',
    };
}
async function applyStylePreset(nodeIds, preset, options = {}) {
    var _a, _b, _c, _d, _e, _f;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        throw new Error('nodeIds is required');
    }
    const nodes = [];
    const missing = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || !('visible' in node)) {
            missing.push(id);
            continue;
        }
        nodes.push(node);
    }
    if (nodes.length === 0)
        throw new Error('No valid nodes found');
    const applied = [];
    const skipped = [];
    const alpha = Number.isFinite(options === null || options === void 0 ? void 0 : options.alpha) ? options.alpha : 1;
    const glow = Number.isFinite(options === null || options === void 0 ? void 0 : options.glow) ? options.glow : 0.5;
    const blurRadius = Number.isFinite(options === null || options === void 0 ? void 0 : options.blurRadius) ? options.blurRadius : 16;
    const presetAliases = {
        glow: 'hero_glow',
        'hero glow': 'hero_glow',
        'gradient button': 'button_gradient_primary',
        gradient_button: 'button_gradient_primary',
        'glass panel': 'panel_glass',
        glass_panel: 'panel_glass',
        shadow: 'card_soft_shadow',
        blur: 'backdrop_blur_soft',
    };
    const normalizedPreset = (_a = presetAliases[String(preset || '').trim().toLowerCase()]) !== null && _a !== void 0 ? _a : preset;
    const applyEffects = (node, effects) => {
        if (!('effects' in node))
            return;
        const normalized = (effects || [])
            .map((e) => normalizeEffectInput(e))
            .filter(Boolean);
        node.effects = normalized;
    };
    for (const node of nodes) {
        try {
            if (!('fills' in node)) {
                skipped.push({ id: node.id, reason: 'no_fills' });
                continue;
            }
            const asGeom = node;
            switch (normalizedPreset) {
                case 'button_gradient_primary':
                case 'button_gradient_vivid': {
                    const vivid = normalizedPreset === 'button_gradient_vivid';
                    asGeom.fills = [{
                            type: 'GRADIENT_LINEAR',
                            gradientTransform: [[1, 0, 0], [0, 1, 0]],
                            gradientStops: vivid
                                ? [
                                    { position: 0, color: { r: 0.99, g: 0.38, b: 0.35, a: alpha } },
                                    { position: 1, color: { r: 0.46, g: 0.22, b: 0.97, a: alpha } },
                                ]
                                : [
                                    { position: 0, color: { r: 0.12, g: 0.47, b: 1, a: alpha } },
                                    { position: 1, color: { r: 0.02, g: 0.78, b: 0.92, a: alpha } },
                                ],
                        }];
                    if ('cornerRadius' in node)
                        node.cornerRadius = (_b = options === null || options === void 0 ? void 0 : options.cornerRadius) !== null && _b !== void 0 ? _b : 14;
                    applyEffects(node, [
                        createDropShadowEffect({
                            color: { r: 0, g: 0, b: 0, a: 0.18 },
                            offsetY: 8,
                            radius: 18,
                        }),
                    ]);
                    break;
                }
                case 'card_soft_shadow': {
                    asGeom.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: alpha }];
                    if ('cornerRadius' in node)
                        node.cornerRadius = (_c = options === null || options === void 0 ? void 0 : options.cornerRadius) !== null && _c !== void 0 ? _c : 16;
                    applyEffects(node, [
                        createDropShadowEffect({
                            color: { r: 0.05, g: 0.08, b: 0.16, a: 0.12 },
                            offsetY: 10,
                            radius: 30,
                        }),
                    ]);
                    break;
                }
                case 'panel_glass': {
                    asGeom.fills = [{
                            type: 'SOLID',
                            color: { r: 1, g: 1, b: 1 },
                            opacity: (_d = options === null || options === void 0 ? void 0 : options.fillOpacity) !== null && _d !== void 0 ? _d : 0.18,
                        }];
                    if ('strokes' in node) {
                        node.strokes = [{
                                type: 'SOLID',
                                color: { r: 1, g: 1, b: 1 },
                                opacity: 0.35,
                            }];
                        node.strokeWeight = 1;
                    }
                    applyEffects(node, [{
                            type: 'BACKGROUND_BLUR',
                            visible: true,
                            blendMode: 'NORMAL',
                            radius: blurRadius,
                        }]);
                    if ('cornerRadius' in node)
                        node.cornerRadius = (_e = options === null || options === void 0 ? void 0 : options.cornerRadius) !== null && _e !== void 0 ? _e : 18;
                    break;
                }
                case 'hero_glow': {
                    applyEffects(node, [
                        createDropShadowEffect({
                            color: { r: 0.12, g: 0.53, b: 1, a: 0.4 * glow },
                            radius: (_f = options === null || options === void 0 ? void 0 : options.radius) !== null && _f !== void 0 ? _f : 36,
                        }),
                    ]);
                    break;
                }
                case 'backdrop_blur_soft': {
                    applyEffects(node, [{
                            type: 'LAYER_BLUR',
                            visible: true,
                            blendMode: 'NORMAL',
                            radius: blurRadius,
                        }]);
                    break;
                }
                default:
                    skipped.push({ id: node.id, reason: `unknown_preset:${normalizedPreset}` });
                    continue;
            }
            applied.push(node.id);
        }
        catch (e) {
            skipped.push({ id: node.id, reason: `apply_failed:${String(e)}` });
        }
    }
    return {
        preset,
        appliedCount: applied.length,
        appliedIds: applied,
        missingIds: missing,
        skipped,
    };
}
// ===== Intelligence Implementation =====
function normalizeScope(scope) {
    const raw = String(scope || 'document').toLowerCase().trim();
    if (raw === 'page' || raw === 'current_page' || raw === 'currentpage' || raw === 'current-page') {
        return 'page';
    }
    if (raw === 'selected_nodes' ||
        raw === 'selected-nodes' ||
        raw === 'selectednodes' ||
        raw === 'selected' ||
        raw === 'selection') {
        return 'selected_nodes';
    }
    return 'document';
}
async function resolveScopeRoots(scope, pageIds, pageNames) {
    const normalizedScope = normalizeScope(scope);
    const ids = Array.isArray(pageIds) ? pageIds.filter(Boolean) : [];
    const names = Array.isArray(pageNames) ? pageNames.filter(Boolean) : [];
    if (ids.length > 0 || names.length > 0) {
        await figma.loadAllPagesAsync();
        const nameSet = new Set(names.map(n => String(n).toLowerCase()));
        const pages = figma.root.children.filter((p) => ids.includes(p.id) || nameSet.has(p.name.toLowerCase()));
        if (pages.length === 0) {
            throw new Error(`No pages matched filters. pageIds=${JSON.stringify(ids)}, pageNames=${JSON.stringify(names)}`);
        }
        return pages;
    }
    if (normalizedScope === 'page') {
        return [figma.currentPage];
    }
    if (normalizedScope === 'selected_nodes') {
        const selected = figma.currentPage.selection.filter(Boolean);
        if (selected.length === 0) {
            throw new Error('Scope "selected_nodes" requires at least one selected node on current page');
        }
        return selected;
    }
    await figma.loadAllPagesAsync();
    return [figma.root];
}
async function analyzeDuplicates(scope = 'document', threshold = 0.9, minOccurrences = 2, pageIds, pageNames, maxGroups = 100, maxNodesPerGroup = 50, maxAnalyzedNodes = 5000) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const allNodes = [];
    const safeMaxAnalyzedNodes = Math.max(100, Math.min(50000, Number.isFinite(maxAnalyzedNodes) ? Math.floor(maxAnalyzedNodes) : 5000));
    const collectNodesWithLimit = (root) => {
        const queue = [root];
        while (queue.length > 0 && allNodes.length < safeMaxAnalyzedNodes) {
            const current = queue.shift();
            if (current.type !== 'DOCUMENT' && current.type !== 'PAGE') {
                const scene = current;
                if ('width' in scene && scene.width > 50) {
                    allNodes.push(scene);
                    if (allNodes.length >= safeMaxAnalyzedNodes)
                        break;
                }
            }
            if ('children' in current) {
                for (const child of current.children) {
                    queue.push(child);
                }
            }
        }
    };
    for (const root of roots) {
        collectNodesWithLimit(root);
        if (allNodes.length >= safeMaxAnalyzedNodes)
            break;
    }
    // Group by similarity
    const groups = [];
    for (const node of allNodes) {
        const features = extractFeatures(node);
        let added = false;
        for (const group of groups) {
            if (calculateSimilarity(features, group.features) >= threshold) {
                group.nodes.push(node);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push({ nodes: [node], features });
        }
    }
    const safeMaxGroups = Math.max(1, Math.min(1000, Number.isFinite(maxGroups) ? Math.floor(maxGroups) : 100));
    const safeMaxNodesPerGroup = Math.max(1, Math.min(200, Number.isFinite(maxNodesPerGroup) ? Math.floor(maxNodesPerGroup) : 50));
    const allDuplicateGroups = groups
        .filter(g => g.nodes.length >= minOccurrences)
        .map(g => ({
        similarity: calculateSimilarity(g.features, g.features),
        count: g.nodes.length,
        nodes: g.nodes.slice(0, safeMaxNodesPerGroup).map(n => ({ id: n.id, name: n.name })),
        nodesTruncated: g.nodes.length > safeMaxNodesPerGroup,
        suggestedAction: g.nodes.length > 3 ? 'Create Component' : 'Review',
    }));
    const duplicates = allDuplicateGroups.slice(0, safeMaxGroups);
    const truncatedGroups = allDuplicateGroups.length > safeMaxGroups;
    return {
        duplicates,
        totalAnalyzed: allNodes.length,
        analyzedNodesTruncated: allNodes.length >= safeMaxAnalyzedNodes,
        maxAnalyzedNodes: safeMaxAnalyzedNodes,
        potentialSavings: allDuplicateGroups.reduce((sum, d) => sum + (d.count - 1), 0),
        returnedGroups: duplicates.length,
        totalGroups: allDuplicateGroups.length,
        truncatedGroups,
        maxGroups: safeMaxGroups,
        maxNodesPerGroup: safeMaxNodesPerGroup,
    };
}
async function suggestComponentStructure(scope = 'document', maxDepth = 3, pageIds, pageNames) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    // Analyze hierarchy
    const frames = [];
    const components = [];
    for (const root of roots) {
        await traverseNodes(root, async (node) => {
            if (node.type === 'FRAME')
                frames.push(node);
            if (node.type === 'COMPONENT')
                components.push(node);
            return true;
        });
    }
    // Suggest structure
    const suggestions = [];
    // Group frames by similarity
    const frameGroups = groupBySimilarity(frames);
    for (const group of frameGroups) {
        if (group.length >= 3) {
            suggestions.push({
                type: 'template',
                description: `Create template for ${group.length} similar frames`,
                nodes: group.map(n => ({ id: n.id, name: n.name })),
            });
        }
    }
    return {
        currentComponents: components.length,
        framesAnalyzed: frames.length,
        suggestions,
    };
}
async function generateNamingScheme(nodeIds, convention = 'semantic') {
    const suggestions = [];
    for (let i = 0; i < nodeIds.length; i++) {
        const node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (!node)
            continue;
        let suggestedName;
        switch (convention) {
            case 'semantic':
                suggestedName = generateSemanticName(node, i);
                break;
            case 'functional':
                suggestedName = generateFunctionalName(node, i);
                break;
            case 'atomic':
                suggestedName = generateAtomicName(node, i);
                break;
            default:
                suggestedName = node.name;
        }
        suggestions.push({
            id: node.id,
            currentName: node.name,
            suggestedName,
        });
        // Apply suggestion
        node.name = suggestedName;
    }
    return {
        renamed: suggestions.length,
        suggestions,
    };
}
async function checkConsistency(scope = 'document', checks = ['colors', 'typography', 'spacing'], pageIds, pageNames) {
    const roots = await resolveScopeRoots(scope, pageIds, pageNames);
    const issues = [];
    // Collect all values
    const colors = new Map();
    const fontSizes = new Map();
    const spacings = new Map();
    for (const root of roots) {
        await traverseNodes(root, async (node) => {
            if ('fills' in node && checks.includes('colors')) {
                const rawFills = node.fills;
                const fills = Array.isArray(rawFills) ? rawFills : [];
                for (const fill of fills) {
                    if (fill.type === 'SOLID' && fill.color) {
                        const key = `${fill.color.r},${fill.color.g},${fill.color.b}`;
                        colors.set(key, (colors.get(key) || 0) + 1);
                    }
                }
            }
            if (node.type === 'TEXT' && checks.includes('typography')) {
                const size = node.fontSize;
                if (typeof size === 'number' && Number.isFinite(size)) {
                    fontSizes.set(size, (fontSizes.get(size) || 0) + 1);
                }
            }
            if ('itemSpacing' in node && checks.includes('spacing')) {
                const spacing = node.itemSpacing;
                if (typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0) {
                    spacings.set(spacing, (spacings.get(spacing) || 0) + 1);
                }
            }
            return true;
        });
    }
    // Check for inconsistencies
    if (checks.includes('colors') && colors.size > 20) {
        issues.push({
            type: 'colors',
            severity: 'warning',
            message: `Found ${colors.size} unique colors. Consider consolidating.`,
            details: Array.from(colors.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([color, count]) => ({ color, count })),
        });
    }
    if (checks.includes('typography') && fontSizes.size > 10) {
        issues.push({
            type: 'typography',
            severity: 'warning',
            message: `Found ${fontSizes.size} unique font sizes. Consider using a type scale.`,
            details: Array.from(fontSizes.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([size, count]) => ({ size, count })),
        });
    }
    return {
        checked: checks,
        issuesFound: issues.length,
        issues,
    };
}
// ===== Utility Implementation =====
async function getDocumentInfo(includeChildren = true, maxDepth = 10, maxPages = 100, maxNodesPerPage = 1200, maxChildrenPerNode = 200) {
    if (includeChildren)
        await ensureAllPagesLoaded();
    const safeMaxPages = Math.max(1, Math.min(500, Number.isFinite(maxPages) ? Math.floor(maxPages) : 100));
    const safeMaxNodesPerPage = Math.max(100, Math.min(10000, Number.isFinite(maxNodesPerPage) ? Math.floor(maxNodesPerPage) : 1200));
    const safeMaxChildrenPerNode = Math.max(20, Math.min(1000, Number.isFinite(maxChildrenPerNode) ? Math.floor(maxChildrenPerNode) : 200));
    const sourcePages = figma.root.children.slice(0, safeMaxPages);
    const pages = sourcePages.map(page => {
        if (!includeChildren) {
            return { id: page.id, name: page.name, children: undefined };
        }
        const state = { remaining: safeMaxNodesPerPage, truncated: false };
        const children = getNodeChildren(page, maxDepth, 0, state, safeMaxChildrenPerNode);
        return {
            id: page.id,
            name: page.name,
            children,
            childrenTruncated: state.truncated,
            maxNodesPerPage: safeMaxNodesPerPage,
            maxChildrenPerNode: safeMaxChildrenPerNode,
        };
    });
    return {
        id: figma.root.id,
        name: figma.root.name,
        type: 'DOCUMENT',
        currentPage: {
            id: figma.currentPage.id,
            name: figma.currentPage.name,
        },
        pages,
        pagesTruncated: figma.root.children.length > sourcePages.length,
        maxPages: safeMaxPages,
    };
}
async function getNodeInfo(nodeId, includeChildren = true) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    return nodeToInfo(node, includeChildren);
}
async function getSelection(includeChildren = false) {
    const selected = figma.currentPage.selection.filter(Boolean);
    const nodes = selected.map((node) => nodeToInfo(node, includeChildren));
    return {
        pageId: figma.currentPage.id,
        pageName: figma.currentPage.name,
        selectedCount: nodes.length,
        nodeIds: nodes.map((n) => n.id),
        nodes,
    };
}
async function setMultipleTextContents(updates) {
    const results = [];
    const errors = [];
    // Group by font to minimize loadFont calls
    const fontGroups = new Map();
    for (const update of updates) {
        const node = await figma.getNodeByIdAsync(update.nodeId);
        if (!node || node.type !== 'TEXT') {
            errors.push({ nodeId: update.nodeId, error: 'Not a text node' });
            continue;
        }
        const fontKey = JSON.stringify(node.fontName);
        if (!fontGroups.has(fontKey)) {
            fontGroups.set(fontKey, []);
        }
        fontGroups.get(fontKey).push({ node, text: update.text });
    }
    // Process each font group
    for (const [fontKey, items] of fontGroups) {
        const fontName = JSON.parse(fontKey);
        await figma.loadFontAsync(fontName);
        for (const item of items) {
            try {
                item.node.characters = item.text;
                results.push({ nodeId: item.node.id, success: true });
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push({ nodeId: item.node.id, error: msg });
            }
        }
    }
    return {
        updated: results.length,
        failed: errors.length,
        errors: errors.slice(0, 10),
    };
}
async function undoOperations(operationId, steps = 1) {
    const undoSteps = Math.max(1, Math.min(20, Math.floor(Number.isFinite(steps) ? steps : 1)));
    for (let i = 0; i < undoSteps; i++) {
        figma.triggerUndo();
    }
    return {
        undone: undoSteps,
        operationId: operationId || null,
        note: 'Applied via Figma undo stack',
    };
}
async function selectNodes(nodeIds, append = false, focus = true) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        throw new Error('nodeIds is required');
    }
    const resolved = [];
    const missing = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || !('visible' in node)) {
            missing.push(id);
            continue;
        }
        resolved.push(node);
    }
    if (resolved.length === 0) {
        throw new Error(`No selectable nodes found. Missing: ${missing.join(', ')}`);
    }
    const targetPage = getNodePage(resolved[0]);
    if (targetPage && figma.currentPage.id !== targetPage.id) {
        await figma.setCurrentPageAsync(targetPage);
    }
    const samePageNodes = resolved.filter((n) => { var _a; return ((_a = getNodePage(n)) === null || _a === void 0 ? void 0 : _a.id) === figma.currentPage.id; });
    const skippedCrossPage = resolved
        .filter((n) => { var _a; return ((_a = getNodePage(n)) === null || _a === void 0 ? void 0 : _a.id) !== figma.currentPage.id; })
        .map((n) => n.id);
    const selected = append
        ? dedupeNodes([...figma.currentPage.selection, ...samePageNodes])
        : samePageNodes;
    figma.currentPage.selection = selected;
    if (focus && selected.length > 0) {
        figma.viewport.scrollAndZoomIntoView(selected);
    }
    return {
        selectedCount: selected.length,
        selectedIds: selected.map((n) => n.id),
        missingIds: missing,
        skippedCrossPageIds: skippedCrossPage,
        pageId: figma.currentPage.id,
    };
}
async function setFocus(nodeIds, nodeId, x, y, zoom) {
    if (typeof x === 'number' && typeof y === 'number') {
        figma.viewport.center = { x, y };
        if (typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0) {
            figma.viewport.zoom = zoom;
        }
        return { mode: 'coordinates', center: figma.viewport.center, zoom: figma.viewport.zoom };
    }
    const ids = Array.isArray(nodeIds) && nodeIds.length > 0 ? nodeIds : (nodeId ? [nodeId] : []);
    if (ids.length === 0) {
        throw new Error('Provide nodeId/nodeIds, or x+y coordinates');
    }
    const nodes = [];
    const pages = [];
    for (const id of ids) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node)
            continue;
        if (node.type === 'PAGE') {
            pages.push(node);
            continue;
        }
        if ('visible' in node)
            nodes.push(node);
    }
    // Allow focusing by page id(s): switch to the first provided page.
    if (nodes.length === 0 && pages.length > 0) {
        const targetPage = pages[0];
        if (figma.currentPage.id !== targetPage.id) {
            await figma.setCurrentPageAsync(targetPage);
        }
        return {
            mode: 'page',
            pageId: figma.currentPage.id,
            pageName: figma.currentPage.name,
            focusedIds: [],
        };
    }
    if (nodes.length === 0) {
        throw new Error('No focusable nodes found');
    }
    const targetPage = getNodePage(nodes[0]);
    if (targetPage && figma.currentPage.id !== targetPage.id) {
        await figma.setCurrentPageAsync(targetPage);
    }
    const samePageNodes = nodes.filter((n) => { var _a; return ((_a = getNodePage(n)) === null || _a === void 0 ? void 0 : _a.id) === figma.currentPage.id; });
    figma.viewport.scrollAndZoomIntoView(samePageNodes);
    return {
        mode: 'nodes',
        focusedIds: samePageNodes.map((n) => n.id),
        pageId: figma.currentPage.id,
    };
}
async function moveNodes(nodeIds, deltaX = 0, deltaY = 0) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        throw new Error('nodeIds is required');
    }
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        throw new Error('deltaX and deltaY must be numbers');
    }
    const moved = [];
    const skipped = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || !('x' in node) || !('y' in node)) {
            skipped.push(id);
            continue;
        }
        const scene = node;
        scene.x = scene.x + deltaX;
        scene.y = scene.y + deltaY;
        moved.push({ id: scene.id, x: scene.x, y: scene.y });
    }
    return {
        movedCount: moved.length,
        moved,
        skippedIds: skipped,
        deltaX,
        deltaY,
    };
}
async function setNodePosition(nodeId, x, y) {
    if (!nodeId)
        throw new Error('nodeId is required');
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('x and y must be numbers');
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || !('x' in node) || !('y' in node)) {
        throw new Error('Node not found or node is not positionable');
    }
    const scene = node;
    scene.x = x;
    scene.y = y;
    return { id: scene.id, x: scene.x, y: scene.y };
}
async function arrangeNodes(nodeIds, layout = 'row', columns, spacingX = 120, spacingY = 120, groupBy = 'none', startX, startY, withinContainerId, placementPolicy = 'min_move', avoidOverlaps = true, verifyVisual = false, snapshotMode = 'selection', snapshotScale = 1, focus = true) {
    var _a, _b;
    const ids = Array.isArray(nodeIds) && nodeIds.length > 0
        ? Array.from(new Set(nodeIds))
        : figma.currentPage.selection.map((n) => n.id);
    if (ids.length === 0) {
        throw new Error('No nodeIds provided and current selection is empty');
    }
    let nodes = [];
    const missingDetails = [];
    for (const id of ids) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) {
            missingDetails.push({ id, reason: 'not_found' });
            continue;
        }
        const nodeType = node.type;
        const pageId = ((_a = getNodePage(node)) === null || _a === void 0 ? void 0 : _a.id) || null;
        if (!('x' in node) || !('y' in node)) {
            missingDetails.push({
                id,
                reason: 'not_positionable',
                nodeType,
                pageId,
            });
            continue;
        }
        if (!('width' in node) || !('height' in node)) {
            missingDetails.push({
                id,
                reason: 'missing_bounds',
                nodeType,
                pageId,
            });
            continue;
        }
        nodes.push(node);
    }
    if (nodes.length === 0) {
        throw new Error('No positionable nodes found');
    }
    const selectedNodeIds = new Set(nodes.map((n) => n.id));
    nodes = nodes.filter((node) => {
        let parent = node.parent;
        while (parent) {
            if (selectedNodeIds.has(parent.id)) {
                return false;
            }
            parent = parent.parent;
        }
        return true;
    });
    nodes = collapseFullSelectionGroups(nodes);
    if (nodes.length === 0) {
        throw new Error('No top-level nodes found (selection contains only descendants of other selected nodes)');
    }
    const targetPage = getNodePage(nodes[0]);
    if (targetPage && figma.currentPage.id !== targetPage.id) {
        await figma.setCurrentPageAsync(targetPage);
    }
    const samePageNodes = nodes.filter((n) => { var _a; return ((_a = getNodePage(n)) === null || _a === void 0 ? void 0 : _a.id) === figma.currentPage.id; });
    for (const node of nodes) {
        const pageId = ((_b = getNodePage(node)) === null || _b === void 0 ? void 0 : _b.id) || null;
        if (pageId && pageId !== figma.currentPage.id) {
            missingDetails.push({
                id: node.id,
                reason: 'cross_page_filtered',
                nodeType: node.type,
                pageId,
                note: `target_page=${figma.currentPage.id}`,
            });
        }
    }
    if (samePageNodes.length === 0) {
        throw new Error('No nodes are on the current page after page switch');
    }
    const needsGrouping = groupBy && groupBy !== 'none';
    const layoutForSort = layout;
    let sorted = [...samePageNodes].sort((a, b) => {
        if (layoutForSort === 'column')
            return (a.y - b.y) || (a.x - b.x);
        return (a.x - b.x) || (a.y - b.y);
    });
    const container = withinContainerId ? await resolveContainer(withinContainerId) : null;
    const containerPad = 24;
    // Optional: ensure nodes are actual children of target container.
    let containerizedCount = 0;
    if (container) {
        const c = await containerizeNodes(sorted.map((n) => n.id), container.id);
        containerizedCount = c.containerizedCount;
        for (let i = 0; i < sorted.length; i++) {
            const n = await figma.getNodeByIdAsync(sorted[i].id);
            if (n && 'x' in n && 'y' in n && 'width' in n && 'height' in n) {
                sorted[i] = n;
            }
        }
    }
    const arrangementMeta = await Promise.all(sorted.map(async (node) => {
        const absoluteRect = sceneNodeToRect(node);
        const parent = node.parent;
        const localWidth = Number.isFinite(node.width) ? node.width : absoluteRect.width;
        const localHeight = Number.isFinite(node.height) ? node.height : absoluteRect.height;
        const localRect = {
            x: node.x,
            y: node.y,
            width: localWidth,
            height: localHeight,
        };
        const area = Math.max(0, localRect.width) * Math.max(0, localRect.height);
        const groupByMode = groupBy || 'none';
        const groupInfo = await resolveArrangeGroup(node, groupByMode);
        return Object.assign({ node, rect: absoluteRect, localRect,
            area, parentId: parent ? parent.id : 'page' }, groupInfo);
    }));
    const beforeUnion = getUnionBounds(arrangementMeta.map((m) => m.rect));
    const gridCols = layout === 'grid'
        ? Math.max(1, Number.isFinite(columns) ? Math.floor(columns) : Math.ceil(Math.sqrt(arrangementMeta.length)))
        : 1;
    const compactSpacingX = layout === 'row'
        ? Math.max(8, needsGrouping ? Math.min(spacingX, 80) : spacingX)
        : Math.max(8, spacingX);
    const compactSpacingY = layout === 'row'
        ? Math.max(8, needsGrouping ? Math.min(spacingY, 60) : spacingY)
        : Math.max(8, spacingY);
    const groupGap = Math.max(compactSpacingX * 1.5, 24);
    const targetIds = new Set(sorted.map((n) => n.id));
    const ancestorIds = new Set();
    for (const node of sorted) {
        let cur = node.parent;
        while (cur) {
            ancestorIds.add(cur.id);
            cur = cur.parent;
        }
    }
    const blockersByParent = new Map();
    if (avoidOverlaps) {
        await traverseNodes(figma.currentPage, async (node) => {
            if (!targetIds.has(node.id) &&
                !ancestorIds.has(node.id) &&
                node.type !== 'SECTION' &&
                'x' in node && 'y' in node && 'width' in node && 'height' in node) {
                const parent = node.parent;
                const parentId = parent && parent.type !== 'PAGE' ? parent.id : 'page';
                const sceneRect = sceneNodeToRect(node);
                const list = blockersByParent.get(parentId) || [];
                list.push({
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                });
                blockersByParent.set(parentId, list);
            }
            return true;
        });
    }
    const arranged = [];
    const allBlockers = [...blockersByParent.values()].flat();
    const beforeQuality = evaluateArrangementQuality(arrangementMeta.map((item) => item.rect), allBlockers);
    const parentGroups = new Map();
    for (const item of arrangementMeta) {
        const parentId = item.parentId || 'page';
        if (!parentGroups.has(parentId))
            parentGroups.set(parentId, []);
        parentGroups.get(parentId).push(item);
    }
    const parentIds = [...parentGroups.keys()];
    for (const parentId of parentIds) {
        const parentItems = parentGroups.get(parentId);
        if (parentItems.length === 0)
            continue;
        const placedRects = [];
        const localBlockers = blockersByParent.get(parentId) || [];
        const baseX = container
            ? Math.max(Number.isFinite(startX) ? startX : containerPad, containerPad)
            : (Number.isFinite(startX)
                ? startX
                : Math.min(...parentItems.map((item) => item.localRect.x)));
        const baseY = container
            ? Math.max(Number.isFinite(startY) ? startY : containerPad, containerPad)
            : (Number.isFinite(startY)
                ? startY
                : Math.min(...parentItems.map((item) => item.localRect.y)));
        const localMaxRight = container
            ? container.width - containerPad
            : Number.POSITIVE_INFINITY;
        const localMaxWidth = Math.max(...parentItems.map((item) => item.localRect.width));
        const localMaxHeight = Math.max(...parentItems.map((item) => item.localRect.height));
        if (layout === 'row' && needsGrouping) {
            const groups = new Map();
            const groupLabels = new Map();
            for (const item of parentItems) {
                if (!groups.has(item.groupKey)) {
                    groups.set(item.groupKey, []);
                    groupLabels.set(item.groupKey, item.groupLabel);
                }
                groups.get(item.groupKey).push(item);
            }
            const rows = Array.from(groups.entries()).map(([key, groupItems]) => {
                const sortedGroup = [...groupItems].sort((a, b) => (b.area - a.area) || (a.localRect.y - b.localRect.y));
                const area = sortedGroup.reduce((sum, i) => sum + i.area, 0);
                return {
                    key,
                    label: groupLabels.get(key) || key,
                    area,
                    items: sortedGroup,
                };
            }).sort((a, b) => (b.area - a.area) || a.label.localeCompare(b.label));
            let groupCursorY = baseY;
            for (const row of rows) {
                let rowCursorX = baseX;
                let rowCursorY = groupCursorY;
                let rowMaxHeight = 0;
                let rowMaxUsedY = baseY;
                for (const item of row.items) {
                    if (localMaxRight !== Number.POSITIVE_INFINITY && rowCursorX + item.localRect.width > localMaxRight && rowCursorX > baseX) {
                        rowCursorX = baseX;
                        rowCursorY += rowMaxHeight + compactSpacingY;
                        rowMaxHeight = 0;
                    }
                    const localCandidate = {
                        x: rowCursorX,
                        y: rowCursorY,
                        width: item.localRect.width,
                        height: item.localRect.height,
                    };
                    let candidate = localCandidate;
                    if (avoidOverlaps) {
                        candidate = resolveCollisionCandidate(candidate, localBlockers, placedRects, 'row', compactSpacingX, compactSpacingY, placementPolicy, container ? { x: 0, y: 0, width: container.width, height: container.height } : undefined, containerPad);
                    }
                    item.node.x = candidate.x;
                    item.node.y = candidate.y;
                    placedRects.push(candidate);
                    rowMaxHeight = Math.max(rowMaxHeight, candidate.height);
                    rowMaxUsedY = Math.max(rowMaxUsedY, candidate.y + candidate.height);
                    arranged.push({
                        id: item.node.id,
                        x: candidate.x,
                        y: candidate.y,
                        groupBy: row.key,
                        groupLabel: row.label,
                        area: item.area,
                    });
                    rowCursorX = candidate.x + candidate.width + compactSpacingX;
                }
                groupCursorY = Math.max(groupCursorY, rowMaxUsedY) + compactSpacingY;
                if (rowMaxHeight > 0) {
                    groupCursorY += Math.max(groupGap - compactSpacingY, compactSpacingY);
                }
            }
            continue;
        }
        const ordered = [...parentItems].sort((a, b) => {
            if (layout === 'column')
                return (b.area - a.area) || (a.localRect.y - b.localRect.y) || (a.localRect.x - b.localRect.x);
            if (layout === 'grid')
                return (b.area - a.area) || (a.localRect.y - b.localRect.y) || (a.localRect.x - b.localRect.x);
            return (b.area - a.area) || (a.localRect.x - b.localRect.x) || (a.localRect.y - b.localRect.y);
        });
        let rowX = baseX;
        let colY = baseY;
        for (let i = 0; i < ordered.length; i++) {
            const item = ordered[i];
            const node = item.node;
            let localCandidate;
            if (layout === 'row') {
                localCandidate = { x: rowX, y: baseY, width: item.localRect.width, height: item.localRect.height };
                rowX += item.localRect.width + compactSpacingX;
            }
            else if (layout === 'column') {
                localCandidate = { x: baseX, y: colY, width: item.localRect.width, height: item.localRect.height };
                colY += item.localRect.height + compactSpacingY;
            }
            else {
                const col = i % gridCols;
                const row = Math.floor(i / gridCols);
                localCandidate = {
                    x: baseX + col * (localMaxWidth + compactSpacingX),
                    y: baseY + row * (localMaxHeight + compactSpacingY),
                    width: item.localRect.width,
                    height: item.localRect.height,
                };
            }
            let candidate = localCandidate;
            if (avoidOverlaps) {
                candidate = resolveCollisionCandidate(candidate, localBlockers, placedRects, layout, compactSpacingX, compactSpacingY, placementPolicy, container ? { x: 0, y: 0, width: container.width, height: container.height } : undefined, containerPad);
            }
            node.x = candidate.x;
            node.y = candidate.y;
            placedRects.push(candidate);
            arranged.push({
                id: node.id,
                x: candidate.x,
                y: candidate.y,
                groupBy: item.groupKey,
                groupLabel: item.groupLabel,
                area: item.area,
            });
        }
    }
    if (focus) {
        figma.viewport.scrollAndZoomIntoView(sorted);
    }
    const afterRects = sorted.map(sceneNodeToRect);
    const afterUnion = getUnionBounds(afterRects);
    const afterQuality = evaluateArrangementQuality(afterRects, allBlockers);
    const parentMismatchCount = container
        ? sorted.filter((n) => { var _a; return ((_a = n.parent) === null || _a === void 0 ? void 0 : _a.id) !== container.id; }).length
        : 0;
    const outsideContainerCount = container
        ? afterRects.filter((r) => !rectInside(r, container)).length
        : 0;
    let visual = undefined;
    if (verifyVisual) {
        const captureMode = snapshotMode || 'selection';
        const beforeShot = captureMode === 'selection'
            ? await captureView('region', undefined, beforeUnion.x, beforeUnion.y, beforeUnion.width, beforeUnion.height, snapshotScale, true, 180)
            : await captureView(captureMode, sorted.map((n) => n.id), beforeUnion.x, beforeUnion.y, beforeUnion.width, beforeUnion.height, snapshotScale, true, 180);
        const afterShot = captureMode === 'selection'
            ? await captureView('region', undefined, afterUnion.x, afterUnion.y, afterUnion.width, afterUnion.height, snapshotScale, true, 180)
            : await captureView(captureMode, sorted.map((n) => n.id), afterUnion.x, afterUnion.y, afterUnion.width, afterUnion.height, snapshotScale, true, 180);
        visual = { before: beforeShot, after: afterShot };
    }
    return {
        arrangedCount: arranged.length,
        layout,
        columns: layout === 'grid' ? gridCols : undefined,
        spacingX,
        spacingY,
        avoidOverlaps,
        withinContainerId: container === null || container === void 0 ? void 0 : container.id,
        placementPolicy,
        containerizedCount,
        quality: {
            before: beforeQuality,
            after: afterQuality,
            overlapDelta: beforeQuality.overlapCount - afterQuality.overlapCount,
            nodeOverlapDelta: beforeQuality.overlapBetweenCandidates - afterQuality.overlapBetweenCandidates,
            parentMismatchCount,
            outsideContainerCount,
        },
        visual,
        arranged,
        missingIds: Array.from(new Set(missingDetails.map((d) => d.id))),
        missingDetails,
        pageId: figma.currentPage.id,
    };
}
async function resolveContainer(containerId) {
    const node = await figma.getNodeByIdAsync(containerId);
    if (!node || !('children' in node) || !('x' in node) || !('y' in node) || !('width' in node) || !('height' in node)) {
        throw new Error(`Invalid containerId: ${containerId}`);
    }
    return node;
}
async function containerizeNodes(nodeIds, containerId) {
    var _a;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        throw new Error('nodeIds is required');
    }
    const container = await resolveContainer(containerId);
    const moved = [];
    const skipped = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || !('x' in node) || !('y' in node) || !('width' in node) || !('height' in node)) {
            skipped.push({ id, reason: 'not_positionable' });
            continue;
        }
        const scene = node;
        if (scene.id === container.id) {
            skipped.push({ id, reason: 'self_container' });
            continue;
        }
        if (((_a = scene.parent) === null || _a === void 0 ? void 0 : _a.id) === container.id) {
            skipped.push({ id, reason: 'already_child' });
            continue;
        }
        const globalRect = sceneNodeToRect(scene);
        try {
            container.appendChild(scene);
            scene.x = globalRect.x - container.x;
            scene.y = globalRect.y - container.y;
            moved.push(scene.id);
        }
        catch (e) {
            skipped.push({ id, reason: `append_failed:${String(e)}` });
        }
    }
    return {
        containerId: container.id,
        containerizedCount: moved.length,
        containerizedIds: moved,
        skipped,
    };
}
async function validateStructure(nodeIds, containerId) {
    const ids = Array.isArray(nodeIds) && nodeIds.length > 0 ? nodeIds : figma.currentPage.selection.map((n) => n.id);
    if (ids.length === 0)
        throw new Error('No nodeIds provided and current selection is empty');
    const nodes = [];
    const missing = [];
    for (const id of ids) {
        const n = await figma.getNodeByIdAsync(id);
        if (!n || !('x' in n) || !('y' in n) || !('width' in n) || !('height' in n)) {
            missing.push(id);
            continue;
        }
        nodes.push(n);
    }
    const rects = nodes.map((n) => sceneNodeToRect(n));
    let overlapPairs = 0;
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (rectsOverlap(rects[i], rects[j]))
                overlapPairs++;
        }
    }
    const getPageId = (node) => {
        let cur = node;
        while (cur) {
            if (cur.type === 'PAGE')
                return cur.id;
            cur = cur.parent;
        }
        return null;
    };
    let container = null;
    let containerPageId = null;
    let containerIsPage = false;
    if (containerId) {
        const rawContainer = await figma.getNodeByIdAsync(containerId);
        if (!rawContainer) {
            throw new Error(`Invalid containerId: ${containerId} (not found)`);
        }
        if (rawContainer.type === 'PAGE') {
            containerIsPage = true;
            containerPageId = rawContainer.id;
        }
        else {
            container = await resolveContainer(containerId);
            containerPageId = getPageId(container);
        }
    }
    const parentMismatch = container
        ? nodes.filter((n) => { var _a; return ((_a = n.parent) === null || _a === void 0 ? void 0 : _a.id) !== container.id; }).map((n) => n.id)
        : containerIsPage
            ? nodes.filter((n) => getPageId(n) !== containerPageId).map((n) => n.id)
            : [];
    const outsideContainer = container
        ? nodes.filter((n) => !rectInside(sceneNodeToRect(n), container)).map((n) => n.id)
        : [];
    return {
        nodeCount: nodes.length,
        missingIds: missing,
        overlapPairs,
        containerId: containerIsPage ? containerId : container === null || container === void 0 ? void 0 : container.id,
        parentMismatchCount: parentMismatch.length,
        parentMismatchIds: parentMismatch,
        outsideContainerCount: outsideContainer.length,
        outsideContainerIds: outsideContainer,
        recommendations: [
            ...(parentMismatch.length ? ['Use containerize_nodes to reparent nodes into container'] : []),
            ...(outsideContainer.length ? ['Use arrange_nodes with withinContainerId to pull nodes inside container'] : []),
            ...(overlapPairs ? ['Use arrange_nodes with avoidOverlaps=true'] : []),
        ],
    };
}
async function captureView(mode = 'selection', nodeIds, x, y, width, height, scale = 1, includeBase64 = true, maxBase64Length = 400) {
    const requestedBounds = await resolveCaptureBounds(mode, nodeIds, x, y, width, height);
    const { bounds, clipped } = clampCaptureBounds(requestedBounds);
    if (bounds.width <= 0 || bounds.height <= 0) {
        throw new Error('Capture bounds are empty');
    }
    const slice = figma.createSlice();
    slice.name = `MCP Capture ${mode}`;
    slice.x = bounds.x;
    slice.y = bounds.y;
    slice.resize(bounds.width, bounds.height);
    figma.currentPage.appendChild(slice);
    try {
        const bytes = await slice.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: Number.isFinite(scale) && scale > 0 ? scale : 1 },
        });
        const base64 = figma.base64Encode(bytes);
        return {
            mode,
            clipped,
            requestedBounds,
            bounds,
            bytesLength: bytes.length,
            imageHash: figma.createImage(bytes).hash,
            base64: includeBase64 ? `${base64.slice(0, Math.max(40, maxBase64Length))}...` : undefined,
        };
    }
    finally {
        slice.remove();
    }
}
function clampCaptureBounds(bounds, maxWidth = 4096, maxHeight = 4096) {
    let { x, y, width, height } = bounds;
    let clipped = false;
    if (width > maxWidth) {
        x = x + (width - maxWidth) / 2;
        width = maxWidth;
        clipped = true;
    }
    if (height > maxHeight) {
        y = y + (height - maxHeight) / 2;
        height = maxHeight;
        clipped = true;
    }
    return { bounds: { x, y, width, height }, clipped };
}
async function resolveCaptureBounds(mode, nodeIds, x, y, width, height) {
    if (mode === 'region') {
        if (![x, y, width, height].every((v) => Number.isFinite(v))) {
            throw new Error('mode=region requires x, y, width, height');
        }
        return { x: x, y: y, width: width, height: height };
    }
    if (mode === 'selection') {
        const ids = Array.isArray(nodeIds) && nodeIds.length > 0 ? nodeIds : figma.currentPage.selection.map((n) => n.id);
        if (ids.length === 0)
            throw new Error('mode=selection requires nodeIds or current selection');
        const nodes = [];
        for (const id of ids) {
            const node = await figma.getNodeByIdAsync(id);
            if (node && 'x' in node && 'y' in node && 'width' in node && 'height' in node) {
                nodes.push(node);
            }
        }
        if (nodes.length === 0)
            throw new Error('No captureable nodes for selection mode');
        return getUnionBounds(nodes.map(sceneNodeToRect));
    }
    // mode === 'page'
    const pageRects = [];
    for (const child of figma.currentPage.children) {
        if ('x' in child && 'y' in child && 'width' in child && 'height' in child) {
            pageRects.push(sceneNodeToRect(child));
        }
    }
    if (pageRects.length === 0) {
        const center = figma.viewport.center;
        return {
            x: center.x - 500,
            y: center.y - 500,
            width: 1000,
            height: 1000,
        };
    }
    return getUnionBounds(pageRects);
}
// ===== Helper Functions =====
function sceneNodeToRect(node) {
    const r = node.absoluteRenderBounds;
    if (r && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0) {
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return { x: node.x, y: node.y, width: node.width, height: node.height };
}
function getUnionBounds(rects) {
    if (rects.length === 0)
        return { x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));
    return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}
function countOverlaps(candidates, blockers) {
    let count = 0;
    for (const c of candidates) {
        if (isDegenerateRect(c))
            continue;
        for (const b of blockers) {
            if (isDegenerateRect(b))
                continue;
            if (rectsOverlap(c, b)) {
                count += 1;
            }
        }
    }
    return count;
}
function rectInside(rect, container, padding = 0) {
    return (rect.x >= container.x + padding &&
        rect.y >= container.y + padding &&
        rect.x + rect.width <= container.x + container.width - padding &&
        rect.y + rect.height <= container.y + container.height - padding);
}
function clampRectIntoContainer(rect, container, padding = 0) {
    const minX = container.x + padding;
    const minY = container.y + padding;
    const maxX = container.x + container.width - padding - rect.width;
    const maxY = container.y + container.height - padding - rect.height;
    return Object.assign(Object.assign({}, rect), { x: Math.max(minX, Math.min(maxX, rect.x)), y: Math.max(minY, Math.min(maxY, rect.y)) });
}
function evaluateArrangementQuality(candidates, blockers) {
    const overlapCount = countOverlaps(candidates, blockers);
    const overlapBetweenCandidates = countCandidateOverlaps(candidates);
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const a = candidates[i];
            const b = candidates[j];
            const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
            const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
            minGap = Math.min(minGap, Math.max(gapX, gapY));
        }
    }
    if (!Number.isFinite(minGap))
        minGap = 0;
    return { overlapCount, overlapBetweenCandidates, minGap };
}
function countCandidateOverlaps(candidates) {
    let count = 0;
    for (let i = 0; i < candidates.length; i++) {
        if (isDegenerateRect(candidates[i]))
            continue;
        for (let j = i + 1; j < candidates.length; j++) {
            if (isDegenerateRect(candidates[j]))
                continue;
            if (rectsOverlap(candidates[i], candidates[j])) {
                count += 1;
            }
        }
    }
    return count;
}
function rectsOverlap(a, b) {
    if (isDegenerateRect(a) || isDegenerateRect(b))
        return false;
    return !(a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y);
}
function isDegenerateRect(rect, eps = 0.5) {
    return (!Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width <= eps ||
        rect.height <= eps);
}
function resolveCollisionCandidate(rect, blockers, placed, layout, spacingX, spacingY, policy = 'preserve_lane', container, containerPadding = 0) {
    const normalizedSpacingX = Number.isFinite(spacingX) ? Math.max(0, spacingX) : 0;
    const normalizedSpacingY = Number.isFinite(spacingY) ? Math.max(0, spacingY) : 0;
    const collisionPad = Math.max(normalizedSpacingX, normalizedSpacingY);
    const stepX = policy === 'min_move'
        ? Math.max(12, Math.min(36, Math.round(Math.max(16, normalizedSpacingX) / 3)))
        : Math.max(16, Math.round(Math.max(20, normalizedSpacingX) / 2));
    const stepY = policy === 'min_move'
        ? Math.max(12, Math.min(36, Math.round(Math.max(16, normalizedSpacingY) / 3)))
        : Math.max(16, Math.round(Math.max(20, normalizedSpacingY) / 2));
    const maxTries = policy === 'strict_no_overlap' ? 3600 : 500;
    const maxCrossShift = policy === 'strict_no_overlap'
        ? Number.POSITIVE_INFINITY
        : (policy === 'min_move' ? Math.max(stepY * 2, 80) : stepY * 2);
    const maxPrimaryShift = policy === 'strict_no_overlap'
        ? Number.POSITIVE_INFINITY
        : (policy === 'min_move' ? Math.max(stepX * 10, 480) : Math.max(stepX * 18, 900));
    const candidateSet = new Set();
    const obstacleRects = [...blockers, ...placed];
    const clampInContainer = (r) => {
        if (!container)
            return r;
        return clampRectIntoContainer(r, container, containerPadding);
    };
    const inflate = (r, pad) => {
        if (!pad)
            return r;
        return {
            x: r.x - pad,
            y: r.y - pad,
            width: r.width + pad * 2,
            height: r.height + pad * 2,
        };
    };
    const normalize = (r) => {
        const normalized = clampInContainer(r);
        return isDegenerateRect(normalized) ? null : normalized;
    };
    const collides = (r) => {
        const normalized = normalize(r);
        if (!normalized)
            return false;
        const expandedCandidate = inflate(normalized, collisionPad);
        for (const b of blockers) {
            if (isDegenerateRect(b))
                continue;
            if (rectsOverlap(expandedCandidate, inflate(b, collisionPad)))
                return true;
        }
        for (const p of placed) {
            if (isDegenerateRect(p))
                continue;
            if (rectsOverlap(expandedCandidate, inflate(p, collisionPad)))
                return true;
        }
        return false;
    };
    const addCandidate = (pool, x, y) => {
        const normalized = normalize(Object.assign(Object.assign({}, rect), { x, y, width: rect.width, height: rect.height }));
        if (!normalized)
            return;
        const key = `${normalized.x},${normalized.y}`;
        if (candidateSet.has(key))
            return;
        candidateSet.add(key);
        pool.push(normalized);
    };
    const rankByDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    let candidate = clampInContainer(Object.assign({}, rect));
    if (!collides(candidate))
        return candidate;
    const fallbackCandidates = [];
    if (layout === 'row') {
        for (let i = 1; i < maxTries; i++) {
            if (i * stepX > maxPrimaryShift)
                break;
            const px = rect.x + i * stepX;
            const py = rect.y;
            const primary = Object.assign(Object.assign({}, rect), { x: px, y: py });
            if (!collides(primary))
                return clampInContainer(primary);
            if (maxCrossShift > 0 && maxCrossShift !== Number.POSITIVE_INFINITY) {
                for (const dy of [stepY, -stepY, stepY * 2, -stepY * 2]) {
                    if (Math.abs(dy) > maxCrossShift)
                        continue;
                    const alt = Object.assign(Object.assign({}, rect), { x: px, y: py + dy });
                    if (!collides(alt))
                        return clampInContainer(alt);
                }
            }
            if (maxCrossShift === Number.POSITIVE_INFINITY) {
                const alt = Object.assign(Object.assign({}, rect), { x: px, y: rect.y + i * stepY });
                if (!collides(alt))
                    return clampInContainer(alt);
            }
        }
    }
    else if (layout === 'column') {
        for (let i = 1; i < maxTries; i++) {
            if (i * stepY > maxPrimaryShift)
                break;
            const py = rect.y + i * stepY;
            const px = rect.x;
            const primary = Object.assign(Object.assign({}, rect), { x: px, y: py });
            if (!collides(primary))
                return clampInContainer(primary);
            if (maxCrossShift > 0 && maxCrossShift !== Number.POSITIVE_INFINITY) {
                for (const dx of [stepX, -stepX, stepX * 2, -stepX * 2]) {
                    if (Math.abs(dx) > maxCrossShift)
                        continue;
                    const alt = Object.assign(Object.assign({}, rect), { x: px + dx, y: py });
                    if (!collides(alt))
                        return clampInContainer(alt);
                }
            }
            if (maxCrossShift === Number.POSITIVE_INFINITY) {
                const alt = Object.assign(Object.assign({}, rect), { x: rect.x + i * stepX, y: py });
                if (!collides(alt))
                    return clampInContainer(alt);
            }
        }
    }
    else {
        for (let i = 0; i < maxTries; i++) {
            const alt = Object.assign(Object.assign({}, rect), { x: rect.x + i * stepX, y: rect.y + i * stepY });
            if (policy !== 'strict_no_overlap' && (i * stepX > maxPrimaryShift || i * stepY > maxPrimaryShift))
                break;
            if (!collides(alt))
                return clampInContainer(alt);
        }
    }
    if (policy === 'strict_no_overlap') {
        const xs = new Set([rect.x, rect.x - stepX, rect.x + stepX]);
        const ys = new Set([rect.y, rect.y - stepY, rect.y + stepY]);
        for (const obs of obstacleRects) {
            if (isDegenerateRect(obs))
                continue;
            xs.add(obs.x - rect.width - normalizedSpacingX);
            xs.add(obs.x + obs.width + normalizedSpacingX);
            xs.add(obs.x);
            xs.add(obs.x + obs.width - rect.width);
            ys.add(obs.y - rect.height - normalizedSpacingY);
            ys.add(obs.y + obs.height + normalizedSpacingY);
            ys.add(obs.y);
            ys.add(obs.y + obs.height - rect.height);
        }
        const orderedX = Array.from(xs).sort((a, b) => Math.abs(a - rect.x) - Math.abs(b - rect.x) || a - b);
        const orderedY = Array.from(ys).sort((a, b) => Math.abs(a - rect.y) - Math.abs(b - rect.y) || a - b);
        for (const y of orderedY) {
            for (const x of orderedX) {
                addCandidate(fallbackCandidates, x, y);
            }
        }
        const ringLimit = Math.max(120, Math.ceil(3600 / Math.max(stepX, 1)));
        for (let ring = 1; ring <= ringLimit; ring++) {
            const dx = ring * stepX;
            const dy = ring * stepY;
            addCandidate(fallbackCandidates, rect.x + dx, rect.y);
            addCandidate(fallbackCandidates, rect.x - dx, rect.y);
            addCandidate(fallbackCandidates, rect.x, rect.y + dy);
            addCandidate(fallbackCandidates, rect.x, rect.y - dy);
            addCandidate(fallbackCandidates, rect.x + dx, rect.y + dy);
            addCandidate(fallbackCandidates, rect.x - dx, rect.y + dy);
            addCandidate(fallbackCandidates, rect.x + dx, rect.y - dy);
            addCandidate(fallbackCandidates, rect.x - dx, rect.y - dy);
            if (ring > maxTries)
                break;
        }
        fallbackCandidates.sort((a, b) => rankByDistance(a, rect) - rankByDistance(b, rect));
        for (const fallback of fallbackCandidates) {
            if (!collides(fallback))
                return fallback;
        }
    }
    return candidate;
}
function isPositionableNode(node) {
    return (!!node &&
        node.type !== 'DOCUMENT' &&
        node.type !== 'PAGE' &&
        'x' in node &&
        'y' in node &&
        'width' in node &&
        'height' in node);
}
function collapseFullSelectionGroups(nodes) {
    var _a;
    const selectedIds = new Set(nodes.map((node) => node.id));
    const parentToChildren = new Map();
    const promotableParentTypes = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'];
    for (const node of nodes) {
        const parent = node.parent;
        if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT')
            continue;
        if (!promotableParentTypes.includes(parent.type) || selectedIds.has(parent.id))
            continue;
        const entry = parentToChildren.get(parent.id);
        if (entry) {
            entry.selectedChildren.add(node.id);
        }
        else {
            parentToChildren.set(parent.id, { parent, selectedChildren: new Set([node.id]) });
        }
    }
    const parentToPromote = new Set();
    for (const { parent, selectedChildren } of parentToChildren.values()) {
        const children = parent.children.filter(isPositionableNode);
        if (children.length < 2)
            continue;
        const allChildrenSelected = children.every((child) => selectedIds.has(child.id));
        if (!allChildrenSelected)
            continue;
        if (children.some((child) => selectedChildren.has(child.id))) {
            parentToPromote.add(parent.id);
        }
    }
    if (parentToPromote.size === 0)
        return nodes;
    const collapsed = nodes.filter((node) => {
        const parent = node.parent;
        return !(parent && parentToPromote.has(parent.id));
    });
    const promotedNodes = new Set(collapsed.map((node) => node.id));
    for (const id of parentToPromote) {
        const parentNode = (_a = parentToChildren.get(id)) === null || _a === void 0 ? void 0 : _a.parent;
        if (parentNode && isPositionableNode(parentNode) && !promotedNodes.has(parentNode.id)) {
            const parentScene = parentNode;
            collapsed.push(parentScene);
            promotedNodes.add(parentScene.id);
        }
    }
    return dedupeNodes(collapsed);
}
function getNodePage(node) {
    let current = node;
    while (current) {
        if (current.type === 'PAGE')
            return current;
        current = current.parent;
    }
    return null;
}
function normalizeArrangeGroupLabel(raw) {
    return raw
        .replace(/\s+/g, ' ')
        .replace(/\/\./g, '-')
        .trim();
}
async function resolveArrangeGroup(node, groupBy) {
    if (groupBy === 'none') {
        return {
            groupKey: 'all',
            groupLabel: 'all',
        };
    }
    const category = node.type;
    if (groupBy === 'type') {
        return {
            groupKey: category,
            groupLabel: category,
        };
    }
    let componentName = '';
    if (node.type === 'INSTANCE') {
        const component = await getInstanceMainComponentSafe(node);
        if (component === null || component === void 0 ? void 0 : component.name)
            componentName = component.name;
    }
    else if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        componentName = node.name;
    }
    if (!componentName) {
        return {
            groupKey: category,
            groupLabel: category,
        };
    }
    const normalized = normalizeArrangeGroupLabel(componentName);
    return {
        groupKey: `${category}::${normalized}`,
        groupLabel: `${category}: ${normalized}`,
    };
}
async function getInstanceMainComponentSafe(instance) {
    var _a;
    try {
        if (typeof instance.getMainComponentAsync === 'function') {
            return await instance.getMainComponentAsync();
        }
    }
    catch (_b) {
        // Fall through to legacy sync access.
    }
    try {
        return (_a = instance.mainComponent) !== null && _a !== void 0 ? _a : null;
    }
    catch (_c) {
        return null;
    }
}
function dedupeNodes(nodes) {
    const seen = new Set();
    const out = [];
    for (const node of nodes) {
        if (!seen.has(node.id)) {
            seen.add(node.id);
            out.push(node);
        }
    }
    return out;
}
function isSceneNode(node) {
    return Boolean(node) && node.type !== 'DOCUMENT' && node.type !== 'PAGE';
}
async function traverseNodes(node, callback) {
    if (node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
        const shouldContinue = await callback(node);
        if (!shouldContinue)
            return;
    }
    if ('children' in node) {
        for (const child of node.children) {
            await traverseNodes(child, callback);
        }
    }
}
function nodeToInfo(node, includeChildren = false) {
    var _a;
    const info = {
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
        locked: node.locked,
    };
    if ('opacity' in node)
        info.opacity = node.opacity;
    if ('blendMode' in node)
        info.blendMode = node.blendMode;
    if ('x' in node) {
        info.x = node.x;
        info.y = node.y;
        info.width = node.width;
        info.height = node.height;
        if ('rotation' in node)
            info.rotation = node.rotation;
    }
    if ('fills' in node)
        info.fills = node.fills;
    if ('strokes' in node)
        info.strokes = node.strokes;
    if ('strokeWeight' in node && typeof node.strokeWeight === 'number')
        info.strokeWeight = node.strokeWeight;
    if ('strokeAlign' in node)
        info.strokeAlign = node.strokeAlign;
    if ('topLeftRadius' in node) {
        info.cornerRadius = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
    }
    else if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
        info.cornerRadius = node.cornerRadius;
    }
    if ('layoutMode' in node) {
        const frame = node;
        info.layoutMode = frame.layoutMode;
        info.primaryAxisAlignItems = frame.primaryAxisAlignItems;
        info.counterAxisAlignItems = frame.counterAxisAlignItems;
        info.paddingTop = frame.paddingTop;
        info.paddingRight = frame.paddingRight;
        info.paddingBottom = frame.paddingBottom;
        info.paddingLeft = frame.paddingLeft;
        info.itemSpacing = frame.itemSpacing;
    }
    if (node.type === 'INSTANCE') {
        try {
            const mainComponent = node.mainComponent;
            if (mainComponent) {
                info.mainComponent = {
                    id: mainComponent.id,
                    name: mainComponent.name,
                    type: mainComponent.type,
                };
            }
        }
        catch (_b) {
            // Dynamic-page mode can throw on sync access; omit optional field.
        }
    }
    if (node.type === 'COMPONENT') {
        const component = node;
        // Check if part of variant
        if (((_a = component.parent) === null || _a === void 0 ? void 0 : _a.type) === 'COMPONENT_SET') {
            try {
                info.variantProperties = component.variantProperties || undefined;
            }
            catch (_c) {
                // Some broken component sets can throw from variantProperties getter.
                info.variantProperties = undefined;
            }
        }
    }
    if ('reactions' in node) {
        info.reactions = [...node.reactions];
    }
    if (includeChildren && 'children' in node) {
        info.children = node.children.map(c => c.id);
    }
    if (node.parent) {
        info.parent = node.parent.id;
    }
    return info;
}
function getNodeChildren(node, maxDepth, currentDepth, state, maxChildrenPerNode = 200) {
    if (currentDepth >= maxDepth || !('children' in node)) {
        return [];
    }
    const children = node.children;
    const maxChildren = Math.min(children.length, Math.max(1, maxChildrenPerNode));
    if (children.length > maxChildren && state) {
        state.truncated = true;
    }
    const out = [];
    for (let i = 0; i < maxChildren; i += 1) {
        if (state && state.remaining <= 0) {
            state.truncated = true;
            break;
        }
        const child = children[i];
        if (state)
            state.remaining -= 1;
        out.push({
            id: child.id,
            name: child.name,
            type: child.type,
            children: getNodeChildren(child, maxDepth, currentDepth + 1, state, maxChildrenPerNode),
        });
    }
    if (state && state.remaining <= 0 && children.length > out.length) {
        state.truncated = true;
    }
    return out;
}
function applyNodeProperties(node, properties) {
    if (properties.x !== undefined && 'x' in node)
        node.x = properties.x;
    if (properties.y !== undefined && 'y' in node)
        node.y = properties.y;
    if ((properties.width !== undefined || properties.height !== undefined) && 'resize' in node && typeof node.resize === 'function') {
        const nextWidth = properties.width !== undefined ? properties.width : node.width;
        const nextHeight = properties.height !== undefined ? properties.height : node.height;
        node.resize(nextWidth, nextHeight);
    }
    if (properties.rotation !== undefined && 'rotation' in node)
        node.rotation = properties.rotation;
    if (properties.opacity !== undefined && 'opacity' in node)
        node.opacity = properties.opacity;
    if (properties.name !== undefined)
        node.name = properties.name;
    if (properties.visible !== undefined)
        node.visible = properties.visible;
    if (properties.fills !== undefined && 'fills' in node) {
        node.fills = normalizePaintArray(properties.fills);
    }
    if (properties.strokes !== undefined && 'strokes' in node) {
        node.strokes = normalizePaintArray(properties.strokes);
    }
    if (properties.layoutMode !== undefined && 'layoutMode' in node) {
        node.layoutMode = properties.layoutMode;
    }
}
function extractFeatures(node) {
    const features = {
        type: node.type,
        width: 'width' in node ? node.width : 0,
        height: 'height' in node ? node.height : 0,
    };
    if ('fills' in node) {
        const rawFills = node.fills;
        const fills = Array.isArray(rawFills) ? rawFills : [];
        const solidFill = fills.find(f => f.type === 'SOLID');
        if (solidFill) {
            features.fillColor = solidFill.color;
            features.fillOpacity = solidFill.opacity;
        }
    }
    if ('cornerRadius' in node) {
        features.cornerRadius = node.cornerRadius;
    }
    if ('layoutMode' in node) {
        features.hasAutoLayout = node.layoutMode !== 'NONE';
    }
    if ('children' in node) {
        features.childCount = node.children.length;
        features.childTypes = node.children.map(c => c.type);
    }
    return features;
}
function calculateSimilarity(a, b) {
    let score = 0;
    let total = 0;
    if (a.type === b.type)
        score += 1;
    total += 1;
    const sizeDiff = Math.abs(a.width - b.width) / Math.max(a.width, b.height) +
        Math.abs(a.height - b.height) / Math.max(a.height, b.height);
    score += Math.max(0, 1 - sizeDiff);
    total += 1;
    if (a.fillColor && b.fillColor) {
        const colorDiff = Math.abs(a.fillColor.r - b.fillColor.r) +
            Math.abs(a.fillColor.g - b.fillColor.g) +
            Math.abs(a.fillColor.b - b.fillColor.b);
        score += Math.max(0, 1 - colorDiff / 3);
        total += 1;
    }
    if (a.cornerRadius !== undefined && b.cornerRadius !== undefined) {
        score += a.cornerRadius === b.cornerRadius ? 1 : 0;
        total += 1;
    }
    if (a.hasAutoLayout !== undefined && b.hasAutoLayout !== undefined) {
        score += a.hasAutoLayout === b.hasAutoLayout ? 1 : 0;
        total += 1;
    }
    return score / total;
}
async function groupSimilarNodes(nodeIds) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    const groups = [];
    for (const node of nodes) {
        const features = extractFeatures(node);
        let added = false;
        for (const group of groups) {
            if (calculateSimilarity(features, group.features) >= 0.85) {
                group.nodes.push(node);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push({ nodes: [node], features });
        }
    }
    return groups.map(g => g.nodes.map(n => n.id));
}
function groupBySimilarity(nodes) {
    const groups = [];
    for (const node of nodes) {
        const features = extractFeatures(node);
        let added = false;
        for (const group of groups) {
            if (calculateSimilarity(features, group.features) >= 0.8) {
                group.nodes.push(node);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push({ nodes: [node], features });
        }
    }
    return groups.map(g => g.nodes);
}
function isButtonLike(node) {
    const name = node.name.toLowerCase();
    return name.includes('button') || name.includes('btn') ||
        (node.type === 'FRAME' && 'width' in node && node.width >= 80 && node.width <= 300 &&
            node.height >= 32 && node.height <= 60);
}
function isCardLike(node) {
    const name = node.name.toLowerCase();
    return name.includes('card') ||
        (node.type === 'FRAME' && 'width' in node && node.width >= 200 && node.height >= 150);
}
function isInputLike(node) {
    const name = node.name.toLowerCase();
    return name.includes('input') || name.includes('field') || name.includes('textfield') ||
        (node.type === 'FRAME' && 'width' in node && node.width >= 150 && node.height >= 32 && node.height <= 56);
}
function matchesColorQuery(color, query) {
    const colorMap = {
        'red': { r: 1, g: 0, b: 0 },
        'blue': { r: 0, g: 0.5, b: 1 },
        'green': { r: 0, g: 1, b: 0 },
        'yellow': { r: 1, g: 1, b: 0 },
        'black': { r: 0, g: 0, b: 0 },
        'white': { r: 1, g: 1, b: 1 },
    };
    const target = colorMap[query.toLowerCase()];
    if (!target)
        return false;
    const threshold = 0.3;
    return Math.abs(color.r - target.r) < threshold &&
        Math.abs(color.g - target.g) < threshold &&
        Math.abs(color.b - target.b) < threshold;
}
function generateComponentName(node) {
    if (isButtonLike(node))
        return 'Button';
    if (isCardLike(node))
        return 'Card';
    if (isInputLike(node))
        return 'Input';
    return node.name.replace(/\s*\d+$/, '');
}
function generateSemanticName(node, index) {
    const typePrefix = node.type === 'FRAME' ? 'Container' :
        node.type === 'RECTANGLE' ? 'Shape' :
            node.type === 'TEXT' ? 'Label' :
                node.type === 'COMPONENT' ? 'Component' :
                    node.type === 'INSTANCE' ? 'Instance' : 'Element';
    return `${typePrefix}/${node.name.replace(/\s*\d+$/, '')}_${index + 1}`;
}
function generateFunctionalName(node, index) {
    if (isButtonLike(node))
        return `Button/${node.name}`;
    if (isCardLike(node))
        return `Card/${node.name}`;
    if (isInputLike(node))
        return `Input/${node.name}`;
    return `UI/${node.name}`;
}
function generateAtomicName(node, index) {
    if (node.type === 'TEXT')
        return `Atoms/Text/${node.name}`;
    if (node.type === 'RECTANGLE')
        return `Atoms/Shape/${node.name}`;
    if (node.type === 'FRAME')
        return `Molecules/${node.name}`;
    if (node.type === 'COMPONENT')
        return `Components/${node.name}`;
    return `Elements/${node.name}`;
}
async function findNodeWithSimilarName(root, baseName, targetName) {
    var _a;
    // Simple name matching - find node with similar naming pattern
    const targetBase = targetName.replace(/\d+/g, '');
    const baseNumber = (_a = baseName.match(/\d+/)) === null || _a === void 0 ? void 0 : _a[0];
    let result = null;
    await traverseNodes(root, async (node) => {
        var _a;
        const nodeBase = node.name.replace(/\d+/g, '');
        if (nodeBase === targetBase) {
            const nodeNumber = (_a = node.name.match(/\d+/)) === null || _a === void 0 ? void 0 : _a[0];
            if (nodeNumber === baseNumber) {
                result = node;
                return false;
            }
        }
        return true;
    });
    return result;
}
function sendProgress(operation, current, total, message) {
    // Find pending operation and send progress
    // This is a simplified version
    console.log(`[${operation}] ${current}/${total}: ${message}`);
}
// ===== Plugin UI =====
figma.showUI(__html__, { width: 320, height: 400, themeColors: true });
function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
// Handle messages from UI (WebSocket messages)
figma.ui.onmessage = async (msg) => {
    var _a;
    switch (msg.type) {
        case 'ws-connected':
        case 'relay-connected':
            if (pendingDisconnectTimer) {
                clearTimeout(pendingDisconnectTimer);
                pendingDisconnectTimer = null;
            }
            activeBridgeSessionId = msg.sessionId || activeBridgeSessionId;
            isConnected = true;
            bridgeLog(`connected session=${String(activeBridgeSessionId || '-')}, channel=${String(msg.channel || '-')}`, 'success');
            figma.notify('✓ Connected to AI Agent');
            break;
        case 'ws-disconnected':
        case 'relay-disconnected':
            // Ignore stale disconnects from any other session.
            // If current active session is null, a disconnect with explicit sessionId is still stale.
            if (msg.sessionId && msg.sessionId !== activeBridgeSessionId) {
                bridgeLog(`ignore stale disconnect session=${String(msg.sessionId)} active=${String(activeBridgeSessionId || '-')}`, 'info');
                break;
            }
            if (pendingDisconnectTimer)
                clearTimeout(pendingDisconnectTimer);
            bridgeLog(`disconnect requested for session=${String(activeBridgeSessionId || '-')}`, 'warning');
            pendingDisconnectTimer = setTimeout(() => {
                isConnected = false;
                bridgeLog(`disconnected session=${String(activeBridgeSessionId || '-')}`, 'warning');
                activeBridgeSessionId = null;
                figma.notify('Disconnected from AI Agent');
            }, 700);
            break;
        case 'ws-message':
        case 'relay-message':
            // Ignore stale messages from any other session.
            if (msg.sessionId && msg.sessionId !== activeBridgeSessionId) {
                bridgeLog(`ignore stale message session=${String(msg.sessionId)} active=${String(activeBridgeSessionId || '-')}`, 'info');
                break;
            }
            if (!msg.payload || !msg.payload.id) {
                figma.ui.postMessage({
                    type: 'response',
                    payload: { id: ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.id) || 'unknown', error: 'Invalid message payload: missing id' }
                });
                break;
            }
            // Handle message from MCP Server
            try {
                const result = await withTimeout(handleMessage(msg.payload), TOOL_EXECUTION_TIMEOUT_MS, `Tool "${String(msg.payload.type || 'unknown')}"`);
                // Send response back to UI -> MCP Server
                figma.ui.postMessage({
                    type: 'response',
                    payload: { id: msg.payload.id, result }
                });
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                figma.ui.postMessage({
                    type: 'response',
                    payload: { id: msg.payload.id, error: errorMsg }
                });
            }
            break;
        case 'get-status':
            bridgeLog(`status request -> ${isConnected ? 'connected' : 'disconnected'} session=${String(activeBridgeSessionId || '-')}`, 'info');
            figma.ui.postMessage({
                type: isConnected ? 'connected' : 'disconnected',
                payload: { sessionId: activeBridgeSessionId },
            });
            break;
        default:
            console.warn(`[Plugin UI] Unknown message type: ${msg.type}`);
            break;
    }
};
// ===== NEW FUNCTIONS: Frame to Components =====
async function frameToComponents(frameId, strategy = 'smart', groupSimilar = true, createVariants = false, organizeOnPage = true, minSize = { width: 50, height: 30 }, excludeTypes = ['GROUP', 'SECTION']) {
    const frame = await figma.getNodeByIdAsync(frameId);
    if (!frame || frame.type !== 'FRAME') {
        throw new Error('Frame not found');
    }
    if (!frame.children || frame.children.length === 0) {
        throw new Error('Frame has no children');
    }
    // Filter eligible children
    let eligibleChildren = frame.children.filter(child => {
        if (child.type === 'INSTANCE' || child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') {
            return false; // Skip existing components
        }
        if (excludeTypes.includes(child.type)) {
            return false;
        }
        if ('width' in child && 'height' in child) {
            return child.width >= minSize.width && child.height >= minSize.height;
        }
        return true;
    });
    if (eligibleChildren.length === 0) {
        return { message: 'No eligible children found' };
    }
    // Group children based on strategy
    let groups = [];
    switch (strategy) {
        case 'smart':
            groups = await groupChildrenSmart(eligibleChildren);
            break;
        case 'by_type':
            groups = groupChildrenByType(eligibleChildren);
            break;
        case 'by_name':
            groups = groupChildrenByName(eligibleChildren);
            break;
        case 'all_children':
            groups = eligibleChildren.map(child => ({ nodes: [child], name: child.name }));
            break;
    }
    // Create components for each group
    const createdComponents = [];
    const componentSetIds = [];
    for (const group of groups) {
        if (group.nodes.length === 0)
            continue;
        // Create component from first node
        const mainNode = group.nodes[0];
        const component = figma.createComponent();
        component.name = generateComponentNameFromNodes(group.nodes);
        // Copy properties from main node
        if ('width' in mainNode && 'height' in mainNode) {
            component.resize(mainNode.width, mainNode.height);
        }
        // Clone children if it's a frame/group
        if ('children' in mainNode) {
            for (const child of mainNode.children) {
                const clone = child.clone();
                component.appendChild(clone);
            }
        }
        else {
            // Clone the entire node
            const clone = mainNode.clone();
            component.appendChild(clone);
        }
        // Position component
        component.x = mainNode.x + mainNode.width + 100;
        component.y = mainNode.y;
        // Create instances for remaining nodes in group
        const instances = [];
        for (let i = 1; i < group.nodes.length; i++) {
            const node = group.nodes[i];
            const instance = component.createInstance();
            if ('x' in node && 'y' in node) {
                instance.x = node.x;
                instance.y = node.y;
            }
            // Replace original with instance
            if (node.parent) {
                const index = node.parent.children.indexOf(node);
                node.parent.insertChild(index, instance);
            }
            node.remove();
            instances.push(instance.id);
        }
        createdComponents.push({
            componentId: component.id,
            name: component.name,
            sourceNodeId: mainNode.id,
            instanceCount: instances.length,
            instanceIds: instances,
        });
        // Remove the original main node
        mainNode.remove();
    }
    // Create variant sets if requested and groups have multiple nodes
    if (createVariants) {
        for (const group of groups) {
            if (group.nodes.length >= 2) {
                // Find created components for this group
                const groupComponentIds = createdComponents
                    .filter(c => group.nodes.some(n => n.id === c.sourceNodeId))
                    .map(c => c.componentId);
                if (groupComponentIds.length >= 2) {
                    const variantComponents = [];
                    for (let i = 0; i < groupComponentIds.length; i++) {
                        const comp = await figma.getNodeByIdAsync(groupComponentIds[i]);
                        if (comp) {
                            comp.name = `Variant=${i + 1}`;
                            variantComponents.push(comp);
                        }
                    }
                    if (variantComponents.length < 2)
                        continue;
                    const parent = variantComponents[0].parent;
                    const componentSet = combineComponentsAsVariants(variantComponents, parent);
                    componentSet.name = group.name;
                    componentSet.x = frame.x;
                    componentSet.y = frame.y + frame.height + 200;
                    componentSetIds.push(componentSet.id);
                }
            }
        }
    }
    // Organize on Components page if requested
    if (organizeOnPage) {
        let componentsPage = figma.root.children.find(p => p.name === 'Components');
        if (!componentsPage) {
            componentsPage = figma.createPage();
            componentsPage.name = 'Components';
        }
        for (const compInfo of createdComponents) {
            const component = await figma.getNodeByIdAsync(compInfo.componentId);
            if (isSceneNode(component)) {
                componentsPage.appendChild(component);
            }
        }
    }
    return {
        frameId,
        frameName: frame.name,
        totalChildren: frame.children.length,
        eligibleChildren: eligibleChildren.length,
        groupsCreated: groups.length,
        componentsCreated: createdComponents.length,
        componentSetsCreated: componentSetIds.length,
        components: createdComponents,
        componentSetIds,
    };
}
async function analyzeFrameStructure(frameId, detectDuplicates = true, minSimilarity = 0.85) {
    const frame = await figma.getNodeByIdAsync(frameId);
    if (!frame || frame.type !== 'FRAME') {
        throw new Error('Frame not found');
    }
    const children = frame.children;
    const analysis = {
        frameId,
        frameName: frame.name,
        totalChildren: children.length,
        childTypes: {},
        sizeDistribution: {
            small: 0, // < 100px
            medium: 0, // 100-300px
            large: 0, // > 300px
        },
        componentCandidates: [],
        duplicateGroups: [],
    };
    // Analyze child types
    for (const child of children) {
        analysis.childTypes[child.type] = (analysis.childTypes[child.type] || 0) + 1;
        if ('width' in child && 'height' in child) {
            const maxDim = Math.max(child.width, child.height);
            if (maxDim < 100)
                analysis.sizeDistribution.small++;
            else if (maxDim <= 300)
                analysis.sizeDistribution.medium++;
            else
                analysis.sizeDistribution.large++;
        }
        // Identify component candidates (non-component nodes with reasonable size)
        if (child.type !== 'COMPONENT' && child.type !== 'INSTANCE' && child.type !== 'COMPONENT_SET') {
            if ('width' in child && child.width >= 50 && child.height >= 30) {
                analysis.componentCandidates.push({
                    id: child.id,
                    name: child.name,
                    type: child.type,
                    width: child.width,
                    height: child.height,
                });
            }
        }
    }
    // Detect duplicates if requested
    if (detectDuplicates) {
        const groups = [];
        for (const child of children) {
            if (child.type === 'COMPONENT' || child.type === 'INSTANCE')
                continue;
            const features = extractFeatures(child);
            let added = false;
            for (const group of groups) {
                if (calculateSimilarity(features, group.features) >= minSimilarity) {
                    group.nodes.push(child);
                    added = true;
                    break;
                }
            }
            if (!added) {
                groups.push({ nodes: [child], features });
            }
        }
        analysis.duplicateGroups = groups
            .filter(g => g.nodes.length >= 2)
            .map(g => ({
            count: g.nodes.length,
            nodes: g.nodes.map(n => ({ id: n.id, name: n.name })),
            suggestedName: generateComponentNameFromNodes(g.nodes),
        }));
    }
    // Generate recommendations
    analysis.recommendations = [];
    if (analysis.duplicateGroups.length > 0) {
        analysis.recommendations.push({
            type: 'merge_duplicates',
            priority: 'high',
            description: `Found ${analysis.duplicateGroups.length} groups of similar elements that could be converted to components`,
            affectedNodes: analysis.duplicateGroups.reduce((sum, g) => sum + g.count, 0),
        });
    }
    if (analysis.componentCandidates.length > 10) {
        analysis.recommendations.push({
            type: 'create_components',
            priority: 'medium',
            description: `Found ${analysis.componentCandidates.length} potential component candidates`,
        });
    }
    return analysis;
}
// ===== NEW FUNCTIONS: Cross-Page Operations =====
async function crossPageCopy(nodeIds, sourcePageId, targetPageId, maintainPosition = true) {
    await ensureAllPagesLoaded();
    const sourcePage = await figma.getNodeByIdAsync(sourcePageId);
    const targetPage = await figma.getNodeByIdAsync(targetPageId);
    if (!sourcePage || sourcePage.type !== 'PAGE') {
        throw new Error('Source page not found');
    }
    if (!targetPage || targetPage.type !== 'PAGE') {
        throw new Error('Target page not found');
    }
    // Switch to source page temporarily
    const originalPage = figma.currentPage;
    await figma.setCurrentPageAsync(sourcePage);
    const copiedNodes = [];
    const errors = [];
    try {
        for (const nodeId of nodeIds) {
            const node = await figma.getNodeByIdAsync(nodeId);
            if (!node) {
                errors.push(`Node ${nodeId} not found`);
                continue;
            }
            const clone = node.clone();
            if (!maintainPosition) {
                // Position relative to page center
                clone.x = (figma.viewport.center.x - clone.width / 2);
                clone.y = (figma.viewport.center.y - clone.height / 2);
            }
            targetPage.appendChild(clone);
            copiedNodes.push(clone.id);
        }
    }
    finally {
        // Restore original page
        await figma.setCurrentPageAsync(originalPage);
    }
    return {
        copied: copiedNodes.length,
        failed: errors.length,
        copiedNodeIds: copiedNodes,
        errors: errors.slice(0, 10),
    };
}
async function crossPageMove(nodeIds, sourcePageId, targetPageId, maintainPosition = true) {
    await ensureAllPagesLoaded();
    const result = await crossPageCopy(nodeIds, sourcePageId, targetPageId, maintainPosition);
    // Delete originals from source page
    const deleted = [];
    for (const nodeId of nodeIds) {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node && node.parent) {
            node.remove();
            deleted.push(nodeId);
        }
    }
    return Object.assign(Object.assign({}, result), { moved: result.copied, deletedFromSource: deleted.length });
}
async function batchEditAcrossPages(operations) {
    await ensureAllPagesLoaded();
    const results = [];
    const errors = [];
    // Group by page
    const pageGroups = new Map();
    for (const op of operations) {
        if (!pageGroups.has(op.pageId)) {
            pageGroups.set(op.pageId, []);
        }
        pageGroups.get(op.pageId).push({ nodeId: op.nodeId, changes: op.changes });
    }
    const originalPage = figma.currentPage;
    for (const [pageId, ops] of pageGroups) {
        const page = await figma.getNodeByIdAsync(pageId);
        if (!page) {
            errors.push({ pageId, error: 'Page not found' });
            continue;
        }
        await figma.setCurrentPageAsync(page);
        for (const op of ops) {
            try {
                const node = await figma.getNodeByIdAsync(op.nodeId);
                if (!node) {
                    errors.push({ pageId, nodeId: op.nodeId, error: 'Node not found' });
                    continue;
                }
                applyNodeProperties(node, op.changes);
                results.push({ pageId, nodeId: op.nodeId, success: true });
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push({ pageId, nodeId: op.nodeId, error: msg });
            }
        }
    }
    await figma.setCurrentPageAsync(originalPage);
    return {
        success: results.length,
        failed: errors.length,
        results,
        errors: errors.slice(0, 10),
    };
}
// ===== NEW FUNCTIONS: Component Set Management =====
async function explodeComponentSet(componentSetId, convertInstancesToMain = false, organizeOnPage = true) {
    var _a;
    const componentSet = await figma.getNodeByIdAsync(componentSetId);
    if (!componentSet || componentSet.type !== 'COMPONENT_SET') {
        throw new Error('Component set not found');
    }
    const variants = componentSet.children.filter(c => c.type === 'COMPONENT');
    const separatedComponents = [];
    const updatedInstances = [];
    // Detach variants from component set
    for (const variant of variants) {
        const originalName = variant.name.split('=').pop() || variant.name;
        const newName = `${componentSet.name}_${originalName}`;
        variant.name = newName;
        separatedComponents.push({
            componentId: variant.id,
            name: variant.name,
        });
    }
    // Remove component set (variants will become standalone components)
    componentSet.remove();
    // Find and update instances if requested
    if (convertInstancesToMain) {
        for (const comp of separatedComponents) {
            const component = await figma.getNodeByIdAsync(comp.componentId);
            if (!component)
                continue;
            await traverseNodes(figma.root, async (node) => {
                if (node.type === 'INSTANCE') {
                    const mainComponent = await getInstanceMainComponentSafe(node);
                    if ((mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.id) !== comp.componentId)
                        return true;
                    // Instance is already linked to this component
                    updatedInstances.push({ instanceId: node.id, componentId: comp.componentId });
                }
                return true;
            });
        }
    }
    // Organize on Components page
    if (organizeOnPage) {
        let componentsPage = figma.root.children.find(p => p.name === 'Components');
        if (!componentsPage) {
            componentsPage = figma.createPage();
            componentsPage.name = 'Components';
        }
        for (const comp of separatedComponents) {
            const component = await figma.getNodeByIdAsync(comp.componentId);
            if (isSceneNode(component) && ((_a = component.parent) === null || _a === void 0 ? void 0 : _a.type) !== 'PAGE') {
                componentsPage.appendChild(component);
            }
        }
    }
    return {
        componentSetId,
        separatedComponents: separatedComponents.length,
        components: separatedComponents,
        instancesUpdated: updatedInstances.length,
    };
}
async function detachAndOrganize(instanceIds, deleteMainComponent = false, organizeBy = 'type', createBackup = true) {
    var _a, _b;
    const detached = [];
    const deletedComponents = [];
    // Create backup page if requested
    let backupPage = null;
    if (createBackup) {
        backupPage = figma.createPage();
        backupPage.name = `Backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    }
    for (const instanceId of instanceIds) {
        const instance = await figma.getNodeByIdAsync(instanceId);
        if (!instance || instance.type !== 'INSTANCE')
            continue;
        const mainComponent = await getInstanceMainComponentSafe(instance);
        // Backup before detaching
        if (backupPage) {
            const backup = instance.clone();
            backupPage.appendChild(backup);
        }
        // Detach instance
        const detachedNode = instance.detachInstance();
        // Organize detached node
        let category = 'Other';
        switch (organizeBy) {
            case 'type':
                category = detachedNode.type;
                break;
            case 'name':
                category = detachedNode.name.split(/[-_\s]/)[0] || 'Other';
                break;
            case 'size':
                if ('width' in detachedNode) {
                    const area = detachedNode.width * detachedNode.height;
                    category = area < 10000 ? 'Small' : area < 50000 ? 'Medium' : 'Large';
                }
                break;
            case 'page_location':
                category = ((_a = detachedNode.parent) === null || _a === void 0 ? void 0 : _a.name) || 'Root';
                break;
        }
        detached.push({
            originalId: instanceId,
            detachedId: detachedNode.id,
            category,
            mainComponentId: mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.id,
        });
        // Delete main component if requested
        if (deleteMainComponent && mainComponent && ((_b = mainComponent.parent) === null || _b === void 0 ? void 0 : _b.type) !== 'COMPONENT_SET') {
            mainComponent.remove();
            if (mainComponent.id)
                deletedComponents.push(mainComponent.id);
        }
    }
    // Group detached nodes by category
    const groupedByCategory = {};
    for (const item of detached) {
        if (!groupedByCategory[item.category]) {
            groupedByCategory[item.category] = [];
        }
        groupedByCategory[item.category].push(item.detachedId);
    }
    return {
        detached: detached.length,
        groupedByCategory,
        deletedComponents: deletedComponents.length,
        backupPageId: backupPage === null || backupPage === void 0 ? void 0 : backupPage.id,
    };
}
async function convertInstancesToComponents(instanceIds, namingPattern = '{original}_Component', organizeOnPage = true) {
    var _a;
    const converted = [];
    for (const instanceId of instanceIds) {
        const instance = await figma.getNodeByIdAsync(instanceId);
        if (!instance || instance.type !== 'INSTANCE')
            continue;
        const mainComponent = await getInstanceMainComponentSafe(instance);
        const newName = namingPattern.replace('{original}', (mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.name) || 'Instance');
        // Detach first
        const detached = instance.detachInstance();
        // Convert to component
        const component = figma.createComponent();
        component.name = newName;
        // Copy detached content
        if ('width' in detached && 'height' in detached) {
            component.resize(detached.width, detached.height);
        }
        if ('children' in detached) {
            for (const child of [...detached.children]) {
                component.appendChild(child);
            }
        }
        // Position and replace
        component.x = detached.x;
        component.y = detached.y;
        if (detached.parent) {
            const index = detached.parent.children.indexOf(detached);
            detached.parent.insertChild(index, component);
        }
        detached.remove();
        converted.push({
            originalInstanceId: instanceId,
            newComponentId: component.id,
            name: component.name,
        });
    }
    // Organize on Components page
    if (organizeOnPage) {
        let componentsPage = figma.root.children.find(p => p.name === 'Components');
        if (!componentsPage) {
            componentsPage = figma.createPage();
            componentsPage.name = 'Components';
        }
        for (const conv of converted) {
            const component = await figma.getNodeByIdAsync(conv.newComponentId);
            if (isSceneNode(component) && ((_a = component.parent) === null || _a === void 0 ? void 0 : _a.type) !== 'PAGE') {
                componentsPage.appendChild(component);
            }
        }
    }
    return {
        converted: converted.length,
        components: converted,
    };
}
async function splitComponentByVariants(componentSetId, keepComponentSet = false, updateInstances = true) {
    const componentSet = await figma.getNodeByIdAsync(componentSetId);
    if (!componentSet || componentSet.type !== 'COMPONENT_SET') {
        throw new Error('Component set not found');
    }
    const variants = [...componentSet.children].filter(c => c.type === 'COMPONENT');
    const separatedComponents = [];
    // Position for separated components
    let offsetX = componentSet.x;
    let offsetY = componentSet.y + componentSet.height + 200;
    for (const variant of variants) {
        const variantName = variant.name.split('=').pop() || variant.name;
        const newName = `${componentSet.name}_${variantName}`;
        // Clone variant as new standalone component
        const newComponent = figma.createComponent();
        newComponent.name = newName;
        // Copy variant content
        if ('width' in variant) {
            newComponent.resize(variant.width, variant.height);
        }
        if ('children' in variant) {
            for (const child of variant.children) {
                const clone = child.clone();
                newComponent.appendChild(clone);
            }
        }
        newComponent.x = offsetX;
        newComponent.y = offsetY;
        offsetX += newComponent.width + 100;
        separatedComponents.push({
            originalVariantId: variant.id,
            newComponentId: newComponent.id,
            name: newComponent.name,
        });
    }
    // Update instances if requested
    if (updateInstances) {
        for (const sep of separatedComponents) {
            const originalVariant = await figma.getNodeByIdAsync(sep.originalVariantId);
            const newComponent = await figma.getNodeByIdAsync(sep.newComponentId);
            if (!originalVariant || !newComponent)
                continue;
            // Find all instances of this variant and swap them
            await traverseNodes(figma.root, async (node) => {
                if (node.type === 'INSTANCE') {
                    const instance = node;
                    const mainComponent = await getInstanceMainComponentSafe(instance);
                    if ((mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.id) === originalVariant.id) {
                        instance.swapComponent(newComponent);
                    }
                }
                return true;
            });
        }
    }
    // Remove component set if not keeping
    if (!keepComponentSet) {
        componentSet.remove();
    }
    return {
        componentSetId,
        separatedComponents: separatedComponents.length,
        components: separatedComponents,
        componentSetKept: keepComponentSet,
    };
}
async function mergeComponentsToSet(componentIds, variantProperty = 'Type', autoDetectValues = true) {
    var _a, _b;
    const components = [];
    for (const id of componentIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && node.type === 'COMPONENT' && ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.type) !== 'COMPONENT_SET') {
            components.push(node);
        }
    }
    if (components.length < 2) {
        throw new Error('Need at least 2 standalone components');
    }
    const parent = components[0].parent;
    if (!parent || !('appendChild' in parent)) {
        throw new Error('Components must be on a page/frame before creating variants');
    }
    // Detect variant values from names if auto-detect
    const baseName = findCommonPrefix(components.map(c => c.name));
    const propertyValues = autoDetectValues
        ? components.map(c => c.name.replace(baseName, '').replace(/^[\-_\s]+/, '') || 'Default')
        : components.map((_, i) => `Variant ${i + 1}`);
    // Add components as variants
    for (let i = 0; i < components.length; i++) {
        const comp = components[i];
        const value = propertyValues[i];
        comp.name = `${variantProperty}=${value}`;
        if (((_b = comp.parent) === null || _b === void 0 ? void 0 : _b.id) !== parent.id) {
            parent.appendChild(comp);
        }
    }
    const componentSet = combineComponentsAsVariants(components, parent);
    componentSet.name = baseName;
    return {
        componentSetId: componentSet.id,
        name: componentSet.name,
        variants: components.length,
        propertyName: variantProperty,
        propertyValues,
    };
}
// ===== Helper Functions =====
async function groupChildrenSmart(children) {
    const groups = [];
    for (const child of children) {
        const features = extractFeatures(child);
        let added = false;
        for (const group of groups) {
            if (calculateSimilarity(features, group.features) >= 0.85) {
                group.nodes.push(child);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push({ nodes: [child], features });
        }
    }
    return groups.map(g => ({
        nodes: g.nodes,
        name: generateComponentNameFromNodes(g.nodes),
    }));
}
function groupChildrenByType(children) {
    const typeGroups = {};
    for (const child of children) {
        if (!typeGroups[child.type]) {
            typeGroups[child.type] = [];
        }
        typeGroups[child.type].push(child);
    }
    return Object.entries(typeGroups).map(([type, nodes]) => ({
        nodes,
        name: `${type}_Group`,
    }));
}
function groupChildrenByName(children) {
    const nameGroups = {};
    for (const child of children) {
        const baseName = child.name.split(/[-_\s\d]/)[0] || 'Other';
        if (!nameGroups[baseName]) {
            nameGroups[baseName] = [];
        }
        nameGroups[baseName].push(child);
    }
    return Object.entries(nameGroups).map(([name, nodes]) => ({
        nodes,
        name: `${name}_Group`,
    }));
}
function generateComponentNameFromNodes(nodes) {
    if (nodes.length === 0)
        return 'Component';
    const first = nodes[0];
    const baseName = first.name.split(/[-_\s\d]/)[0] || 'Element';
    if (isButtonLike(first))
        return 'Button';
    if (isCardLike(first))
        return 'Card';
    if (isInputLike(first))
        return 'Input';
    return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}
function findCommonPrefix(names) {
    if (names.length === 0)
        return 'ComponentSet';
    if (names.length === 1)
        return names[0];
    const sorted = [...names].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    let i = 0;
    while (i < first.length && first[i] === last[i]) {
        i++;
    }
    return first.substring(0, i).replace(/[-_\s]+$/, '') || 'ComponentSet';
}
// ===== BASIC NODE CREATION IMPLEMENTATIONS =====
async function resolveParentForAppend(parentId) {
    if (!parentId)
        return null;
    const parent = await figma.getNodeByIdAsync(parentId);
    if (!parent || typeof parent.appendChild !== 'function')
        return null;
    return parent;
}
async function appendToTargetParent(node, parentId) {
    const parent = await resolveParentForAppend(parentId);
    if (parent) {
        parent.appendChild(node);
        return;
    }
    figma.currentPage.appendChild(node);
}
async function createEllipse(x, y, width, height, options) {
    const ellipse = figma.createEllipse();
    ellipse.x = x;
    ellipse.y = y;
    ellipse.resize(width, height);
    if (options.name)
        ellipse.name = options.name;
    if (options.fills)
        ellipse.fills = normalizePaintArray(options.fills);
    await appendToTargetParent(ellipse, options.parentId);
    return { id: ellipse.id, name: ellipse.name, type: ellipse.type };
}
async function createLine(x, y, width, height, options) {
    const line = figma.createLine();
    line.x = x;
    line.y = y;
    line.resize(width, height);
    if (options.name)
        line.name = options.name;
    if (options.strokeWeight)
        line.strokeWeight = options.strokeWeight;
    if (options.strokes)
        line.strokes = normalizePaintArray(options.strokes);
    await appendToTargetParent(line, options.parentId);
    return { id: line.id, name: line.name, type: line.type };
}
async function createPolygon(x, y, width, height, options) {
    const polygon = figma.createPolygon();
    polygon.x = x;
    polygon.y = y;
    polygon.resize(width, height);
    polygon.pointCount = options.pointCount || 5;
    if (options.name)
        polygon.name = options.name;
    if (options.fills)
        polygon.fills = normalizePaintArray(options.fills);
    await appendToTargetParent(polygon, options.parentId);
    return { id: polygon.id, name: polygon.name, type: polygon.type, pointCount: polygon.pointCount };
}
async function createStar(x, y, width, height, options) {
    const star = figma.createStar();
    star.x = x;
    star.y = y;
    star.resize(width, height);
    star.pointCount = options.pointCount || 5;
    star.innerRadius = options.innerRadius || 0.5;
    if (options.name)
        star.name = options.name;
    if (options.fills)
        star.fills = normalizePaintArray(options.fills);
    await appendToTargetParent(star, options.parentId);
    return { id: star.id, name: star.name, type: star.type, pointCount: star.pointCount };
}
function normalizeVectorPathsInput(input) {
    const sanitizePathData = (raw) => {
        // Figma vector parser is strict: commands and numbers must be tokenized with spaces.
        return raw
            .replace(/,/g, ' ')
            .replace(/([A-Za-z])/g, ' $1 ')
            .replace(/\s+/g, ' ')
            .trim();
    };
    const toPathObject = (value) => {
        if (typeof value === 'string') {
            const data = sanitizePathData(value);
            if (!data)
                throw new Error('vector path string is empty');
            return { data, windingRule: 'NONZERO' };
        }
        if (value && typeof value === 'object') {
            const rawData = typeof value.data === 'string'
                ? value.data
                : (typeof value.path === 'string' ? value.path : (typeof value.d === 'string' ? value.d : ''));
            const data = sanitizePathData(rawData);
            if (!data)
                throw new Error('vector path object is missing data/path/d');
            const windingRuleRaw = String(value.windingRule || 'NONZERO').toUpperCase();
            const windingRule = ['NONZERO', 'EVENODD', 'NONE'].includes(windingRuleRaw) ? windingRuleRaw : 'NONZERO';
            return { data, windingRule: windingRule };
        }
        throw new Error(`Unsupported vector path entry type: ${typeof value}`);
    };
    if (Array.isArray(input)) {
        if (input.length === 0)
            throw new Error('vectorPaths array is empty');
        return input.map(toPathObject);
    }
    return [toPathObject(input)];
}
function parseHexToRGB(value) {
    const normalized = value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        const r = parseInt(normalized[0] + normalized[0], 16) / 255;
        const g = parseInt(normalized[1] + normalized[1], 16) / 255;
        const b = parseInt(normalized[2] + normalized[2], 16) / 255;
        return { r, g, b };
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = parseInt(normalized.slice(0, 2), 16) / 255;
        const g = parseInt(normalized.slice(2, 4), 16) / 255;
        const b = parseInt(normalized.slice(4, 6), 16) / 255;
        return { r, g, b };
    }
    return null;
}
function normalizePaintArray(input) {
    if (!Array.isArray(input))
        return input;
    return input.map((entry) => {
        if (typeof entry === 'string') {
            const rgb = parseHexToRGB(entry);
            if (!rgb)
                throw new Error(`Unsupported color string: ${entry}`);
            return { type: 'SOLID', color: rgb };
        }
        if (entry && typeof entry === 'object')
            return entry;
        throw new Error(`Unsupported paint entry type: ${typeof entry}`);
    });
}
async function createVector(x, y, width, height, options) {
    var _a, _b, _c, _d;
    const vector = figma.createVector();
    vector.x = x;
    vector.y = y;
    vector.resize(width, height);
    if (options.name)
        vector.name = options.name;
    const rawVectorPaths = (_d = (_c = (_b = (_a = options.vectorPaths) !== null && _a !== void 0 ? _a : options.vectorPath) !== null && _b !== void 0 ? _b : options.path) !== null && _c !== void 0 ? _c : options.svgPath) !== null && _d !== void 0 ? _d : options.d;
    if (rawVectorPaths !== undefined && rawVectorPaths !== null) {
        vector.vectorPaths = normalizeVectorPathsInput(rawVectorPaths);
    }
    if (options.fills)
        vector.fills = normalizePaintArray(options.fills);
    if (options.strokes)
        vector.strokes = normalizePaintArray(options.strokes);
    if (options.strokeWeight)
        vector.strokeWeight = options.strokeWeight;
    await appendToTargetParent(vector, options.parentId);
    return { id: vector.id, name: vector.name, type: vector.type };
}
async function createGroup(nodeIds, name, parentId) {
    const nodes = [];
    for (const id of nodeIds || []) {
        if (typeof id !== 'string' || !id)
            continue;
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    if (nodes.length === 0)
        throw new Error('No valid nodes to group');
    const parent = nodes[0].parent;
    const group = figma.group(nodes, parent);
    if (name)
        group.name = name;
    if (parentId) {
        const newParent = await resolveParentForAppend(parentId);
        if (newParent)
            newParent.appendChild(group);
    }
    return { id: group.id, name: group.name, type: group.type, childrenCount: group.children.length };
}
async function createSection(x, y, width, height, options) {
    const createFrameFallback = async () => {
        const frame = figma.createFrame();
        frame.x = x;
        frame.y = y;
        frame.resize(width, height);
        frame.name = options.name || 'Section (fallback)';
        if (options.fills)
            frame.fills = options.fills;
        await appendToTargetParent(frame, options.parentId);
        return { id: frame.id, name: frame.name, type: frame.type, fallback: true };
    };
    try {
        if (typeof figma.createSection !== 'function') {
            return await createFrameFallback();
        }
        const section = figma.createSection();
        section.x = x;
        section.y = y;
        section.resizeWithoutConstraints(width, height);
        if (options.name)
            section.name = options.name;
        if (options.fills)
            section.fills = options.fills;
        await appendToTargetParent(section, options.parentId);
        return { id: section.id, name: section.name, type: section.type };
    }
    catch (_a) {
        return await createFrameFallback();
    }
}
async function createSlice(x, y, width, height, name) {
    const slice = figma.createSlice();
    slice.x = x;
    slice.y = y;
    slice.resize(width, height);
    if (name)
        slice.name = name;
    figma.currentPage.appendChild(slice);
    return { id: slice.id, name: slice.name, type: slice.type };
}
async function createConnector(startNodeId, endNodeId, options) {
    const connector = figma.createConnector();
    const startNode = await figma.getNodeByIdAsync(startNodeId);
    const endNode = await figma.getNodeByIdAsync(endNodeId);
    if (!startNode || !endNode)
        throw new Error('Start or end node not found');
    connector.connectorStart = {
        endpointNodeId: startNodeId,
        magnet: options.startMagnet || 'AUTO',
    };
    connector.connectorEnd = {
        endpointNodeId: endNodeId,
        magnet: options.endMagnet || 'AUTO',
    };
    if (options.strokeWeight)
        connector.strokeWeight = options.strokeWeight;
    if (options.strokes)
        connector.strokes = options.strokes;
    return { id: connector.id, type: connector.type };
}
async function createSticky(x, y, text, color, parentId) {
    if (typeof figma.createSticky !== 'function') {
        // Fallback for non-FigJam editors: simulate a sticky with a frame + text.
        const note = figma.createFrame();
        note.name = 'Sticky (fallback)';
        note.x = x;
        note.y = y;
        note.resize(180, 140);
        note.cornerRadius = 12;
        note.fills = [{ type: 'SOLID', color: { r: 1, g: 0.97, b: 0.7 } }];
        if (text) {
            const txt = figma.createText();
            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            txt.characters = text;
            txt.x = 12;
            txt.y = 12;
            note.appendChild(txt);
        }
        await appendToTargetParent(note, parentId);
        return { id: note.id, type: note.type, text: text || '' };
    }
    const sticky = figma.createSticky();
    sticky.x = x;
    sticky.y = y;
    if (color)
        sticky.color = color;
    if (text) {
        await figma.loadFontAsync(sticky.text.fontName);
        sticky.text.characters = text;
    }
    await appendToTargetParent(sticky, parentId);
    return { id: sticky.id, type: sticky.type, text: sticky.text.characters };
}
async function createShapeWithText(x, y, width, height, options) {
    if (typeof figma.createShapeWithText !== 'function') {
        // Fallback for non-FigJam editors.
        const frame = figma.createFrame();
        frame.x = x;
        frame.y = y;
        frame.resize(width, height);
        frame.fills = options.fills || [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
        frame.cornerRadius = 12;
        if (options.text) {
            const txt = figma.createText();
            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            txt.characters = options.text;
            txt.x = 12;
            txt.y = 12;
            frame.appendChild(txt);
        }
        await appendToTargetParent(frame, options.parentId);
        return { id: frame.id, type: frame.type, shapeType: 'FALLBACK_FRAME' };
    }
    const shape = figma.createShapeWithText();
    shape.x = x;
    shape.y = y;
    shape.resize(width, height);
    if (options.shapeType)
        shape.shapeType = options.shapeType;
    if (options.fills)
        shape.fills = options.fills;
    if (options.text) {
        await figma.loadFontAsync(shape.text.fontName);
        shape.text.characters = options.text;
    }
    await appendToTargetParent(shape, options.parentId);
    return { id: shape.id, type: shape.type, shapeType: shape.shapeType };
}
async function createTable(x, y, rowCount = 3, columnCount = 3, options) {
    // Figma doesn't have native table creation, so we simulate with frames
    const tableFrame = figma.createFrame();
    tableFrame.x = x;
    tableFrame.y = y;
    tableFrame.name = options.name || 'Table';
    tableFrame.layoutMode = 'VERTICAL';
    tableFrame.itemSpacing = 0;
    tableFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    const cellWidth = options.cellWidth || 100;
    const cellHeight = options.cellHeight || 40;
    for (let r = 0; r < rowCount; r++) {
        const rowFrame = figma.createFrame();
        rowFrame.name = `Row ${r + 1}`;
        rowFrame.layoutMode = 'HORIZONTAL';
        rowFrame.itemSpacing = 0;
        rowFrame.layoutSizingHorizontal = 'HUG';
        rowFrame.layoutSizingVertical = 'HUG';
        for (let c = 0; c < columnCount; c++) {
            const cell = figma.createFrame();
            cell.name = `Cell ${r + 1}-${c + 1}`;
            cell.resize(cellWidth, cellHeight);
            cell.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
            cell.strokes = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
            cell.strokeWeight = 1;
            rowFrame.appendChild(cell);
        }
        tableFrame.appendChild(rowFrame);
    }
    await appendToTargetParent(tableFrame, options.parentId);
    return {
        id: tableFrame.id,
        name: tableFrame.name,
        type: tableFrame.type,
        rows: rowCount,
        columns: columnCount
    };
}
// ===== BOOLEAN OPERATIONS =====
async function booleanOperation(nodeIds, operation, name, parentId) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    if (nodes.length < 2)
        throw new Error('Need at least 2 nodes for boolean operation');
    let resultNode;
    switch (operation) {
        case 'UNION':
            resultNode = figma.union(nodes, nodes[0].parent);
            break;
        case 'SUBTRACT':
            resultNode = figma.subtract(nodes, nodes[0].parent);
            break;
        case 'INTERSECT':
            resultNode = figma.intersect(nodes, nodes[0].parent);
            break;
        case 'EXCLUDE':
            resultNode = figma.exclude(nodes, nodes[0].parent);
            break;
    }
    if (name)
        resultNode.name = name;
    if (parentId) {
        const newParent = await resolveParentForAppend(parentId);
        if (newParent)
            newParent.appendChild(resultNode);
    }
    return { id: resultNode.id, name: resultNode.name, type: resultNode.type, booleanOperation: resultNode.booleanOperation };
}
async function flattenNodes(nodeIds, parentId) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    if (nodes.length === 0)
        throw new Error('No valid nodes to flatten');
    const flattened = figma.flatten(nodes, nodes[0].parent);
    if (parentId) {
        const newParent = await resolveParentForAppend(parentId);
        if (newParent)
            newParent.appendChild(flattened);
    }
    return { id: flattened.id, name: flattened.name, type: flattened.type };
}
// ===== NODE PROPERTIES =====
async function setConstraints(nodeId, horizontal, vertical) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    if (!('constraints' in node))
        throw new Error('Node does not support constraints');
    const normalize = (value) => {
        const v = String(value).toUpperCase();
        if (v === 'MIN' || v === 'MAX' || v === 'CENTER' || v === 'STRETCH' || v === 'SCALE')
            return v;
        if (v === 'LEFT' || v === 'TOP')
            return 'MIN';
        if (v === 'RIGHT' || v === 'BOTTOM')
            return 'MAX';
        if (v === 'LEFT_RIGHT' || v === 'TOP_BOTTOM')
            return 'STRETCH';
        throw new Error(`Unsupported constraint value: ${value}`);
    };
    node.constraints = {
        horizontal: normalize(horizontal),
        vertical: normalize(vertical),
    };
    return { id: node.id, constraints: node.constraints };
}
async function setLayoutGrid(nodeId, layoutGrids) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'FRAME')
        throw new Error('Frame not found');
    const input = (layoutGrids || []).map((g) => (Object.assign({}, g)));
    const trySets = [];
    const parseNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const normalizeAlignment = (value, fallback = 'STRETCH') => {
        const v = String(value || fallback).toUpperCase();
        if (v === 'MIN' || v === 'CENTER' || v === 'STRETCH')
            return v;
        return fallback;
    };
    const normalizePattern = (value) => {
        const v = String(value || 'COLUMNS').toUpperCase();
        if (v === 'GRID' || v === 'ROWS')
            return v;
        return 'COLUMNS';
    };
    const normalizeColor = (raw) => {
        const r = Number(raw === null || raw === void 0 ? void 0 : raw.r);
        const g = Number(raw === null || raw === void 0 ? void 0 : raw.g);
        const b = Number(raw === null || raw === void 0 ? void 0 : raw.b);
        const a = Number(raw === null || raw === void 0 ? void 0 : raw.a);
        const unit = (n, fallback) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback);
        return {
            r: unit(r, 1),
            g: unit(g, 0),
            b: unit(b, 0),
            a: unit(a, 0.1),
        };
    };
    const normalizeGrid = (g) => {
        var _a;
        const pattern = normalizePattern(g === null || g === void 0 ? void 0 : g.pattern);
        const visible = (g === null || g === void 0 ? void 0 : g.visible) !== false;
        const color = normalizeColor(g === null || g === void 0 ? void 0 : g.color);
        if (pattern === 'GRID') {
            return {
                pattern: 'GRID',
                sectionSize: parseNum((_a = g === null || g === void 0 ? void 0 : g.sectionSize) !== null && _a !== void 0 ? _a : g === null || g === void 0 ? void 0 : g.size, 8),
                color,
                visible,
            };
        }
        const alignment = normalizeAlignment(g === null || g === void 0 ? void 0 : g.alignment, 'STRETCH');
        const out = {
            pattern,
            alignment,
            count: parseNum(g === null || g === void 0 ? void 0 : g.count, 12),
            gutterSize: parseNum(g === null || g === void 0 ? void 0 : g.gutterSize, 20),
            color,
            visible,
            offset: parseNum(g === null || g === void 0 ? void 0 : g.offset, 0),
        };
        if (alignment !== 'STRETCH') {
            out.sectionSize = parseNum(g === null || g === void 0 ? void 0 : g.sectionSize, 60);
        }
        return out;
    };
    const normalizeGridWithSectionSize = (g) => {
        const out = normalizeGrid(g);
        if (out.pattern === 'COLUMNS' || out.pattern === 'ROWS') {
            out.sectionSize = parseNum(g === null || g === void 0 ? void 0 : g.sectionSize, 60);
        }
        return out;
    };
    // 1) Caller-provided payload first
    trySets.push(input);
    // 2) Normalized schema-preserving payload
    trySets.push(input.map((g) => normalizeGrid(g)));
    // 3) Normalized payload with explicit sectionSize for columns/rows
    trySets.push(input.map((g) => normalizeGridWithSectionSize(g)));
    let applied = false;
    for (const candidate of trySets) {
        try {
            node.layoutGrids = candidate;
            applied = true;
            break;
        }
        catch (_a) {
            // Try next normalization strategy
        }
    }
    if (!applied) {
        throw new Error('Unable to apply layout grids: invalid schema for current Figma API (no silent GRID fallback applied)');
    }
    return { id: node.id, layoutGrids: node.layoutGrids };
}
async function setEffects(nodeId, effects) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    if (!('effects' in node))
        throw new Error('Node does not support effects');
    let normalized = effects;
    if (!Array.isArray(normalized)) {
        throw new Error('effects must be an array');
    }
    normalized = normalized
        .map((e) => {
        if (typeof e === 'string') {
            try {
                return JSON.parse(e);
            }
            catch (_a) {
                return null;
            }
        }
        return e;
    })
        .filter(Boolean)
        .map((e) => normalizeEffectInput(e))
        .filter(Boolean);
    node.effects = normalized;
    return { id: node.id, effects: node.effects };
}
async function setExportSettings(nodeId, exportSettings) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    node.exportSettings = exportSettings;
    return { id: node.id, exportSettings: node.exportSettings };
}
async function setBlendMode(nodeId, blendMode) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    if (!('blendMode' in node))
        throw new Error('Node does not support blend mode');
    node.blendMode = blendMode;
    return { id: node.id, blendMode: node.blendMode };
}
async function setMask(nodeId, isMask, maskType) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    if (!('isMask' in node)) {
        throw new Error('Node does not support mask');
    }
    if (isMask) {
        node.isMask = true;
        if (maskType && 'maskType' in node) {
            node.maskType = maskType;
        }
    }
    else {
        node.isMask = false;
    }
    return { id: node.id, isMask: node.isMask };
}
// ===== AUTO LAYOUT =====
async function setAutoLayout(nodeId, options) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'FRAME')
        throw new Error('Frame not found');
    if (options.layoutMode)
        node.layoutMode = options.layoutMode;
    if (options.primaryAxisAlignItems)
        node.primaryAxisAlignItems = options.primaryAxisAlignItems;
    if (options.counterAxisAlignItems)
        node.counterAxisAlignItems = options.counterAxisAlignItems;
    if (options.paddingTop !== undefined)
        node.paddingTop = options.paddingTop;
    if (options.paddingRight !== undefined)
        node.paddingRight = options.paddingRight;
    if (options.paddingBottom !== undefined)
        node.paddingBottom = options.paddingBottom;
    if (options.paddingLeft !== undefined)
        node.paddingLeft = options.paddingLeft;
    if (options.itemSpacing !== undefined)
        node.itemSpacing = options.itemSpacing;
    if (options.counterAxisSpacing !== undefined)
        node.counterAxisSpacing = options.counterAxisSpacing;
    if (options.layoutWrap)
        node.layoutWrap = options.layoutWrap;
    return {
        id: node.id,
        layoutMode: node.layoutMode,
        primaryAxisAlignItems: node.primaryAxisAlignItems,
        counterAxisAlignItems: node.counterAxisAlignItems,
    };
}
async function removeAutoLayout(nodeId, keepPosition = true) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'FRAME')
        throw new Error('Frame not found');
    const originalPositions = keepPosition ? node.children.map(child => ({
        id: child.id,
        x: child.x,
        y: child.y,
    })) : [];
    node.layoutMode = 'NONE';
    if (keepPosition) {
        for (const pos of originalPositions) {
            const child = await figma.getNodeByIdAsync(pos.id);
            if (child) {
                child.x = pos.x;
                child.y = pos.y;
            }
        }
    }
    return { id: node.id, layoutMode: node.layoutMode };
}
async function alignNodes(nodeIds, alignment) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && 'x' in node && 'y' in node)
            nodes.push(node);
    }
    if (nodes.length < 2)
        throw new Error('Need at least 2 nodes to align');
    // Calculate bounds
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const rights = nodes.map(n => n.x + n.width);
    const bottoms = nodes.map(n => n.y + n.height);
    const minX = Math.min(...xs);
    const maxX = Math.max(...rights);
    const minY = Math.min(...ys);
    const maxY = Math.max(...bottoms);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    for (const node of nodes) {
        switch (alignment) {
            case 'TOP_LEFT':
                node.x = minX;
                node.y = minY;
                break;
            case 'TOP_CENTER':
                node.x = centerX - node.width / 2;
                node.y = minY;
                break;
            case 'TOP_RIGHT':
                node.x = maxX - node.width;
                node.y = minY;
                break;
            case 'MIDDLE_LEFT':
                node.x = minX;
                node.y = centerY - node.height / 2;
                break;
            case 'MIDDLE_CENTER':
                node.x = centerX - node.width / 2;
                node.y = centerY - node.height / 2;
                break;
            case 'MIDDLE_RIGHT':
                node.x = maxX - node.width;
                node.y = centerY - node.height / 2;
                break;
            case 'BOTTOM_LEFT':
                node.x = minX;
                node.y = maxY - node.height;
                break;
            case 'BOTTOM_CENTER':
                node.x = centerX - node.width / 2;
                node.y = maxY - node.height;
                break;
            case 'BOTTOM_RIGHT':
                node.x = maxX - node.width;
                node.y = maxY - node.height;
                break;
        }
    }
    return { aligned: nodes.length, alignment };
}
async function distributeNodes(nodeIds, direction, spacing) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && 'x' in node && 'y' in node)
            nodes.push(node);
    }
    if (nodes.length < 3)
        throw new Error('Need at least 3 nodes to distribute');
    // Sort nodes
    if (direction === 'HORIZONTAL') {
        nodes.sort((a, b) => a.x - b.x);
    }
    else {
        nodes.sort((a, b) => a.y - b.y);
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (direction === 'HORIZONTAL') {
        const totalWidth = last.x + last.width - first.x;
        const totalItemsWidth = nodes.reduce((sum, n) => sum + n.width, 0);
        const gap = spacing !== undefined ? spacing : (totalWidth - totalItemsWidth) / (nodes.length - 1);
        let currentX = first.x;
        for (const node of nodes) {
            node.x = currentX;
            currentX += node.width + gap;
        }
    }
    else {
        const totalHeight = last.y + last.height - first.y;
        const totalItemsHeight = nodes.reduce((sum, n) => sum + n.height, 0);
        const gap = spacing !== undefined ? spacing : (totalHeight - totalItemsHeight) / (nodes.length - 1);
        let currentY = first.y;
        for (const node of nodes) {
            node.y = currentY;
            currentY += node.height + gap;
        }
    }
    return { distributed: nodes.length, direction };
}
// ===== STYLES =====
async function createEffectStyle(name, effects, sourceNodeId) {
    let finalEffects = effects;
    if (sourceNodeId && !effects) {
        const node = await figma.getNodeByIdAsync(sourceNodeId);
        if (node && 'effects' in node) {
            finalEffects = node.effects;
        }
    }
    if (Array.isArray(finalEffects)) {
        finalEffects = finalEffects
            .map((e) => {
            if (typeof e === 'string') {
                try {
                    return JSON.parse(e);
                }
                catch (_a) {
                    return null;
                }
            }
            return e;
        })
            .filter(Boolean)
            .map((e) => normalizeEffectInput(e))
            .filter(Boolean);
    }
    const style = figma.createEffectStyle();
    style.name = name;
    if (finalEffects)
        style.effects = finalEffects;
    return { styleId: style.id, name: style.name, type: style.type };
}
function normalizeEffectInput(raw) {
    var _a, _b, _c, _d, _e, _f;
    if (!raw || typeof raw !== 'object')
        return null;
    const toUnit = (v, fallback = 0) => {
        const n = Number(v);
        if (!Number.isFinite(n))
            return fallback;
        const normalized = n > 1 ? n / 255 : n;
        return Math.max(0, Math.min(1, normalized));
    };
    const toNum = (v, fallback = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const type = String(raw.type || '').toUpperCase();
    const visible = raw.visible !== false;
    const blendMode = raw.blendMode || 'NORMAL';
    if (type === 'DROP_SHADOW' || type === 'INNER_SHADOW') {
        return {
            type: type,
            visible,
            blendMode,
            color: {
                r: toUnit((_a = raw.color) === null || _a === void 0 ? void 0 : _a.r, 0),
                g: toUnit((_b = raw.color) === null || _b === void 0 ? void 0 : _b.g, 0),
                b: toUnit((_c = raw.color) === null || _c === void 0 ? void 0 : _c.b, 0),
                a: toUnit((_d = raw.color) === null || _d === void 0 ? void 0 : _d.a, 0.2),
            },
            offset: {
                x: toNum((_e = raw.offset) === null || _e === void 0 ? void 0 : _e.x, 0),
                y: toNum((_f = raw.offset) === null || _f === void 0 ? void 0 : _f.y, 4),
            },
            radius: toNum(raw.radius, 8),
            spread: toNum(raw.spread, DEFAULT_DROP_SHADOW_SPREAD),
        };
    }
    if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
        return {
            type: type,
            visible,
            radius: toNum(raw.radius, 4),
        };
    }
    return raw;
}
async function createGridStyle(name, layoutGrids, sourceNodeId) {
    let finalGrids = layoutGrids;
    if (sourceNodeId && !layoutGrids) {
        const node = await figma.getNodeByIdAsync(sourceNodeId);
        if (node && node.type === 'FRAME') {
            finalGrids = [...node.layoutGrids];
        }
    }
    const style = figma.createGridStyle();
    style.name = name;
    if (Array.isArray(finalGrids)) {
        const input = finalGrids
            .map((g) => {
            if (typeof g === 'string') {
                try {
                    return JSON.parse(g);
                }
                catch (_a) {
                    return null;
                }
            }
            return g;
        })
            .filter(Boolean);
        const parseNum = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        const normalizeAlignment = (value, fallback = 'STRETCH') => {
            const v = String(value || fallback).toUpperCase();
            if (v === 'MIN' || v === 'CENTER' || v === 'STRETCH')
                return v;
            return fallback;
        };
        const normalizePattern = (value) => {
            const v = String(value || 'COLUMNS').toUpperCase();
            if (v === 'GRID' || v === 'ROWS')
                return v;
            return 'COLUMNS';
        };
        const normalizeColor = (raw) => {
            const r = Number(raw === null || raw === void 0 ? void 0 : raw.r);
            const g = Number(raw === null || raw === void 0 ? void 0 : raw.g);
            const b = Number(raw === null || raw === void 0 ? void 0 : raw.b);
            const a = Number(raw === null || raw === void 0 ? void 0 : raw.a);
            const unit = (n, fallback) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback);
            return {
                r: unit(r, 1),
                g: unit(g, 0),
                b: unit(b, 0),
                a: unit(a, 0.1),
            };
        };
        const normalizeGrid = (g) => {
            var _a;
            const pattern = normalizePattern(g === null || g === void 0 ? void 0 : g.pattern);
            const visible = (g === null || g === void 0 ? void 0 : g.visible) !== false;
            const color = normalizeColor(g === null || g === void 0 ? void 0 : g.color);
            if (pattern === 'GRID') {
                return {
                    pattern: 'GRID',
                    sectionSize: parseNum((_a = g === null || g === void 0 ? void 0 : g.sectionSize) !== null && _a !== void 0 ? _a : g === null || g === void 0 ? void 0 : g.size, 8),
                    color,
                    visible,
                };
            }
            const alignment = normalizeAlignment(g === null || g === void 0 ? void 0 : g.alignment, 'STRETCH');
            const out = {
                pattern,
                alignment,
                count: parseNum(g === null || g === void 0 ? void 0 : g.count, 12),
                gutterSize: parseNum(g === null || g === void 0 ? void 0 : g.gutterSize, 20),
                color,
                visible,
                offset: parseNum(g === null || g === void 0 ? void 0 : g.offset, 0),
            };
            if (alignment !== 'STRETCH') {
                out.sectionSize = parseNum(g === null || g === void 0 ? void 0 : g.sectionSize, 60);
            }
            return out;
        };
        const normalizeGridWithSectionSize = (g) => {
            const out = normalizeGrid(g);
            if (out.pattern === 'COLUMNS' || out.pattern === 'ROWS') {
                out.sectionSize = parseNum(g === null || g === void 0 ? void 0 : g.sectionSize, 60);
            }
            return out;
        };
        const candidates = [];
        candidates.push(input);
        candidates.push(input.map((g) => normalizeGrid(g)));
        candidates.push(input.map((g) => normalizeGridWithSectionSize(g)));
        let applied = false;
        for (const c of candidates) {
            try {
                style.layoutGrids = c;
                applied = true;
                break;
            }
            catch (_a) {
                // try next
            }
        }
        if (!applied) {
            throw new Error('Unable to apply layout grids to style: invalid schema (no silent GRID fallback applied)');
        }
    }
    return { styleId: style.id, name: style.name, type: style.type };
}
async function updatePaintStyle(styleId, name, paints) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'PAINT')
        throw new Error('Paint style not found');
    if (name)
        style.name = name;
    if (paints)
        style.paints = paints;
    return { styleId: style.id, name: style.name };
}
async function updateTextStyle(styleId, options) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style || style.type !== 'TEXT')
        throw new Error('Text style not found');
    if (options.name)
        style.name = options.name;
    if (options.fontName)
        style.fontName = options.fontName;
    if (options.fontSize)
        style.fontSize = options.fontSize;
    if (options.lineHeight)
        style.lineHeight = options.lineHeight;
    if (options.letterSpacing)
        style.letterSpacing = options.letterSpacing;
    return { styleId: style.id, name: style.name };
}
async function deleteStyle(styleId, detachNodes = true) {
    const style = await figma.getStyleByIdAsync(styleId);
    if (!style)
        throw new Error('Style not found');
    style.remove();
    return { deleted: true, styleId };
}
async function getAllStyles(type) {
    let styles = [];
    const normalized = String(type !== null && type !== void 0 ? type : 'ALL').trim().toUpperCase();
    const includeAll = !type || normalized === 'ALL';
    if (includeAll || normalized === 'PAINT') {
        styles = [...styles, ...(await figma.getLocalPaintStylesAsync())];
    }
    if (includeAll || normalized === 'TEXT') {
        styles = [...styles, ...(await figma.getLocalTextStylesAsync())];
    }
    if (includeAll || normalized === 'EFFECT') {
        styles = [...styles, ...(await figma.getLocalEffectStylesAsync())];
    }
    if (includeAll || normalized === 'GRID') {
        styles = [...styles, ...(await figma.getLocalGridStylesAsync())];
    }
    return {
        count: styles.length,
        styles: styles.map(s => ({ id: s.id, name: s.name, type: s.type })),
    };
}
// ===== VARIABLES =====
async function createVariable(name, type, value, collectionId) {
    var _a;
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection)
        throw new Error('Variable collection not found');
    // Sanitize arbitrary MCP input into a Figma-compatible variable name.
    const safeName = String(name || 'var')
        .replace(/[^\p{L}\p{N}_\-\s]/gu, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'var';
    const normalizedName = /^[\p{L}_]/u.test(safeName) ? safeName : `v_${safeName}`;
    const variable = figma.variables.createVariable(normalizedName, collection, type);
    // Set value for the first mode
    if (value !== undefined && collection.modes.length > 0) {
        let finalValue = value;
        if (typeof value === 'string') {
            try {
                finalValue = JSON.parse(value);
            }
            catch (_b) {
                finalValue = value;
            }
        }
        const resolved = String(type).toUpperCase();
        if (resolved === 'FLOAT') {
            const n = Number(finalValue);
            if (Number.isFinite(n))
                finalValue = n;
        }
        else if (resolved === 'BOOLEAN') {
            if (typeof finalValue === 'string')
                finalValue = finalValue.toLowerCase() === 'true';
            else
                finalValue = Boolean(finalValue);
        }
        else if (resolved === 'COLOR' && finalValue && typeof finalValue === 'object') {
            const toUnit = (v) => {
                const n = Number(v);
                if (!Number.isFinite(n))
                    return 0;
                return Math.max(0, Math.min(1, n > 1 ? n / 255 : n));
            };
            finalValue = {
                r: toUnit(finalValue.r),
                g: toUnit(finalValue.g),
                b: toUnit(finalValue.b),
                a: toUnit((_a = finalValue.a) !== null && _a !== void 0 ? _a : 1),
            };
        }
        variable.setValueForMode(collection.modes[0].modeId, finalValue);
    }
    return { variableId: variable.id, name: variable.name, type: variable.resolvedType };
}
async function createVariableCollection(name, modes) {
    const collection = figma.variables.createVariableCollection(name);
    // Rename default mode or add additional modes
    if (modes && modes.length > 0) {
        collection.renameMode(collection.modes[0].modeId, modes[0]);
        for (let i = 1; i < modes.length; i++) {
            collection.addMode(modes[i]);
        }
    }
    return {
        collectionId: collection.id,
        name: collection.name,
        modes: collection.modes.map(m => ({ id: m.modeId, name: m.name }))
    };
}
async function setVariableValue(variableId, modeId, value) {
    var _a;
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable)
        throw new Error('Variable not found');
    let finalValue = value;
    if (typeof value === 'string') {
        try {
            finalValue = JSON.parse(value);
        }
        catch (_b) {
            finalValue = value;
        }
    }
    const resolved = String(variable.resolvedType).toUpperCase();
    if (resolved === 'FLOAT') {
        const n = Number(finalValue);
        if (!Number.isFinite(n))
            throw new Error('FLOAT variable requires numeric value');
        finalValue = n;
    }
    else if (resolved === 'BOOLEAN') {
        if (typeof finalValue === 'string')
            finalValue = finalValue.toLowerCase() === 'true';
        else
            finalValue = Boolean(finalValue);
    }
    else if (resolved === 'STRING') {
        finalValue = String(finalValue);
    }
    else if (resolved === 'COLOR' && finalValue && typeof finalValue === 'object') {
        const toUnit = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n))
                return 0;
            return Math.max(0, Math.min(1, n > 1 ? n / 255 : n));
        };
        finalValue = {
            r: toUnit(finalValue.r),
            g: toUnit(finalValue.g),
            b: toUnit(finalValue.b),
            a: toUnit((_a = finalValue.a) !== null && _a !== void 0 ? _a : 1),
        };
    }
    variable.setValueForMode(modeId, finalValue);
    return { variableId, modeId, value: finalValue };
}
async function bindVariableToNode(nodeId, variableId, property) {
    const node = await figma.getNodeByIdAsync(nodeId);
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!node)
        throw new Error('Node not found');
    if (!variable)
        throw new Error('Variable not found');
    const key = String(property || '').toUpperCase();
    if (key === 'FILLS') {
        if (!('fills' in node))
            throw new Error('Node does not support fills');
        const fills = node.fills || [];
        node.fills = fills.map((p) => {
            if (p.type === 'SOLID')
                return figma.variables.setBoundVariableForPaint(p, 'color', variable);
            return p;
        });
        return { nodeId, variableId, property: key };
    }
    if (key === 'STROKES') {
        if (!('strokes' in node))
            throw new Error('Node does not support strokes');
        const strokes = node.strokes || [];
        node.strokes = strokes.map((p) => {
            if (p.type === 'SOLID')
                return figma.variables.setBoundVariableForPaint(p, 'color', variable);
            return p;
        });
        return { nodeId, variableId, property: key };
    }
    const fieldMap = {
        OPACITY: 'opacity',
        WIDTH: 'width',
        HEIGHT: 'height',
        VISIBLE: 'visible',
        CHARACTERS: 'characters',
    };
    const field = fieldMap[key];
    if (!field || typeof node.setBoundVariable !== 'function') {
        throw new Error(`Unsupported bind property: ${property}`);
    }
    node.setBoundVariable(field, variable);
    return { nodeId, variableId, property: key };
}
async function unbindVariable(nodeId, property) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    const key = String(property || '').toUpperCase();
    if (key === 'FILLS' && 'fills' in node) {
        const fills = node.fills || [];
        node.fills = fills.map((p) => {
            if (p.type === 'SOLID')
                return figma.variables.setBoundVariableForPaint(p, 'color', null);
            return p;
        });
        return { nodeId, property: key, unbound: true };
    }
    if (key === 'STROKES' && 'strokes' in node) {
        const strokes = node.strokes || [];
        node.strokes = strokes.map((p) => {
            if (p.type === 'SOLID')
                return figma.variables.setBoundVariableForPaint(p, 'color', null);
            return p;
        });
        return { nodeId, property: key, unbound: true };
    }
    const fieldMap = {
        OPACITY: 'opacity',
        WIDTH: 'width',
        HEIGHT: 'height',
        VISIBLE: 'visible',
        CHARACTERS: 'characters',
    };
    const field = fieldMap[key];
    if (!field || typeof node.setBoundVariable !== 'function') {
        throw new Error(`Unsupported unbind property: ${property}`);
    }
    node.setBoundVariable(field, null);
    return { nodeId, property: key, unbound: true };
}
async function getAllVariables() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const allVariables = [];
    for (const collection of collections) {
        for (const variableId of collection.variableIds) {
            const variable = await figma.variables.getVariableByIdAsync(variableId);
            if (variable) {
                allVariables.push({
                    id: variable.id,
                    name: variable.name,
                    type: variable.resolvedType,
                    collectionId: collection.id,
                    collectionName: collection.name,
                });
            }
        }
    }
    return {
        collections: collections.map(c => ({ id: c.id, name: c.name })),
        variables: allVariables,
    };
}
let allPagesLoaded = false;
async function ensureAllPagesLoaded() {
    if (allPagesLoaded)
        return;
    await figma.loadAllPagesAsync();
    allPagesLoaded = true;
}
async function deleteVariable(variableId, unbindNodes = true) {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable)
        throw new Error('Variable not found');
    variable.remove();
    return { deleted: true, variableId };
}
// ===== PAGE MANAGEMENT =====
async function createPage(name, index) {
    await ensureAllPagesLoaded();
    const page = figma.createPage();
    page.name = name;
    if (index !== undefined) {
        figma.root.insertChild(index, page);
    }
    return { pageId: page.id, name: page.name, index: figma.root.children.indexOf(page) };
}
async function deletePage(pageId, confirm = false) {
    await ensureAllPagesLoaded();
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE')
        throw new Error('Page not found');
    if (figma.root.children.length <= 1) {
        throw new Error('Cannot delete the last page');
    }
    let switchedPageId = null;
    if (figma.currentPage.id === pageId) {
        const fallback = figma.root.children.find((p) => p.id !== pageId);
        if (!fallback) {
            throw new Error('Cannot delete the active page because no fallback page exists');
        }
        await figma.setCurrentPageAsync(fallback);
        switchedPageId = fallback.id;
    }
    page.remove();
    return { deleted: true, pageId, switchedPageId };
}
async function renamePage(pageId, newName) {
    await ensureAllPagesLoaded();
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE')
        throw new Error('Page not found');
    page.name = newName;
    return { pageId, name: page.name };
}
async function reorderPages(pageIds) {
    await ensureAllPagesLoaded();
    // Remove all pages first
    const pages = [];
    for (const id of pageIds) {
        const page = await figma.getNodeByIdAsync(id);
        if (page)
            pages.push(page);
    }
    // Re-add in new order
    for (const page of pages) {
        figma.root.appendChild(page);
    }
    return { reordered: pages.length };
}
async function duplicatePage(pageId, newName) {
    await ensureAllPagesLoaded();
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE')
        throw new Error('Page not found');
    const newPage = figma.createPage();
    newPage.name = newName || `${page.name} Copy`;
    // Clone all children
    for (const child of page.children) {
        const clone = child.clone();
        newPage.appendChild(clone);
    }
    return { pageId: newPage.id, name: newPage.name, copiedChildren: newPage.children.length };
}
// ===== MEDIA & EXPORT =====
async function createImageFill(url, hash, nodeId) {
    let image;
    if (hash) {
        image = figma.getImageByHash(hash);
        if (!image)
            throw new Error(`Image hash not found: ${hash}`);
    }
    else if (url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            image = figma.createImage(new Uint8Array(buffer));
            hash = image.hash;
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load image URL. Ensure manifest networkAccess allows this domain. ${msg}`);
        }
    }
    else {
        throw new Error('Either url or hash required');
    }
    if (nodeId) {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node && 'fills' in node) {
            const fills = node.fills;
            const newFills = fills.map(f => {
                if (f.type === 'SOLID') {
                    return {
                        type: 'IMAGE',
                        imageHash: hash,
                        scaleMode: 'FILL',
                    };
                }
                return f;
            });
            node.fills = newFills;
        }
    }
    return { hash: image === null || image === void 0 ? void 0 : image.hash, nodeId };
}
async function exportNode(nodeId, format, scale = 1, suffix) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        throw new Error('Node not found');
    const bytes = await node.exportAsync({
        format,
        constraint: { type: 'SCALE', value: scale },
    });
    // Convert to base64 for transfer
    const base64 = figma.base64Encode(bytes);
    return {
        nodeId,
        format,
        scale,
        suffix,
        bytesLength: bytes.length,
        base64: base64.slice(0, 100) + '...', // Truncate for display
    };
}
async function exportNodesBatch(exports) {
    const results = [];
    const errors = [];
    for (const exp of exports) {
        try {
            const result = await exportNode(exp.nodeId, exp.format, exp.scale || 1, exp.suffix);
            results.push(result);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push({ nodeId: exp.nodeId, error: msg });
        }
    }
    return { exported: results.length, failed: errors.length, results, errors };
}
// ===== COMPONENT PROPERTIES =====
async function addComponentProperty(componentId, name, type, defaultValue) {
    const component = await figma.getNodeByIdAsync(componentId);
    if (!component || component.type !== 'COMPONENT')
        throw new Error('Component not found');
    // Note: Component property API may vary
    // This is a placeholder implementation
    return {
        componentId,
        propertyName: name,
        type,
        note: 'Component properties may require manual configuration in Figma UI'
    };
}
async function setComponentProperty(instanceId, propertyName, value) {
    const node = await figma.getNodeByIdAsync(instanceId);
    if (!node)
        throw new Error('Node not found');
    if (node.type !== 'INSTANCE') {
        throw new Error(`Node ${instanceId} is ${node.type}. set_component_property only supports INSTANCE nodes.`);
    }
    const instance = node;
    // Set component property
    if (instance.componentProperties[propertyName]) {
        instance.setProperties({ [propertyName]: value });
    }
    return { instanceId, propertyName, value };
}
async function removeComponentProperty(componentId, propertyName) {
    const component = await figma.getNodeByIdAsync(componentId);
    if (!component || component.type !== 'COMPONENT')
        throw new Error('Component not found');
    // Note: Property removal may require specific API
    return { componentId, propertyName, removed: true };
}
// ===== TRANSFORM OPERATIONS =====
async function scaleNodes(nodeIds, scaleX, scaleY, center) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && 'x' in node && 'y' in node)
            nodes.push(node);
    }
    // Calculate center point
    let cx = center === null || center === void 0 ? void 0 : center.x;
    let cy = center === null || center === void 0 ? void 0 : center.y;
    if (cx === undefined || cy === undefined) {
        const xs = nodes.map(n => n.x + n.width / 2);
        const ys = nodes.map(n => n.y + n.height / 2);
        cx = xs.reduce((a, b) => a + b, 0) / xs.length;
        cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    }
    for (const node of nodes) {
        const n = node;
        // Scale size
        n.resize(n.width * scaleX, n.height * scaleY);
        // Reposition relative to center
        n.x = cx + (n.x - cx) * scaleX;
        n.y = cy + (n.y - cy) * scaleY;
    }
    return { scaled: nodes.length, scaleX, scaleY };
}
async function flipNodes(nodeIds, direction) {
    const nodes = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node)
            nodes.push(node);
    }
    for (const node of nodes) {
        if ('relativeTransform' in node) {
            const t = node.relativeTransform;
            if (direction === 'horizontal') {
                node.relativeTransform = [
                    [-t[0][0], t[0][1], t[0][2]],
                    [-t[1][0], t[1][1], t[1][2]],
                ];
            }
            else {
                node.relativeTransform = [
                    [t[0][0], -t[0][1], t[0][2]],
                    [t[1][0], -t[1][1], t[1][2]],
                ];
            }
        }
    }
    return { flipped: nodes.length, direction };
}
// ===== ADVANCED IMPORT =====
async function loadComponentFromFile(fileKey, componentKey) {
    const component = await figma.importComponentByKeyAsync(componentKey);
    return {
        componentId: component.id,
        name: component.name,
        fileKey,
        componentKey,
    };
}
async function loadStyleFromFile(fileKey, styleKey) {
    const style = await figma.importStyleByKeyAsync(styleKey);
    return {
        styleId: style.id,
        name: style.name,
        type: style.type,
        fileKey,
        styleKey,
    };
}
