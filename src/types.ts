// Figma Node Types
export type NodeType = 
  | 'DOCUMENT' | 'CANVAS' | 'FRAME' | 'GROUP' | 'SECTION'
  | 'VECTOR' | 'BOOLEAN_OPERATION' | 'STAR' | 'LINE' | 'ELLIPSE' | 'REGULAR_POLYGON' | 'RECTANGLE' | 'TEXT'
  | 'SLICE' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE' | 'STICKY' | 'CONNECTOR' | 'SHAPE_WITH_TEXT'
  | 'CODE_BLOCK' | 'STAMP' | 'WIDGET' | 'MEDIA' | 'HIGHLIGHT' | 'VARIABLE_ALIAS' | 'CURSOR'
  | 'SOLID' | 'TABLE' | 'TABLE_CELL' | 'LINK_UNFURL' | 'EMBED' | 'CHART' | 'SLIDE' | 'SLIDE_ROW'
  | 'SLIDE_OVERLAY' | 'PDF' | 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Enhanced Node Info
export interface NodeInfo {
  id: string;
  name: string;
  type: NodeType;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  cornerRadius?: number | number[];
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  children?: string[];
  parent?: string;
  pageId?: string;
  componentProperties?: Record<string, any>;
  variantProperties?: Record<string, string>;
  mainComponent?: {
    id: string;
    name: string;
    type: 'COMPONENT' | 'COMPONENT_SET';
    fileKey?: string;
  };
  // Prototype
  reactions?: Reaction[];
}

export interface Paint {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | 'EMOJI';
  color?: RGB;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

export interface Reaction {
  action?: Action;
  actions?: Action[];
  trigger?: Trigger;
}

export interface Action {
  type: 'NODE' | 'BACK' | 'CLOSE' | 'URL' | 'UPDATE_MEDIA_RUNTIME' | 'OVERLAY' | 'SWAP'
    | 'SWAP_STATE' | 'RESET_STATE' | 'OPEN_LINK';
  destinationId?: string;
  navigation?: 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SCROLL_TO' | 'CHANGE_TO';
  transition?: {
    type: 'DISSOLVE' | 'SMART_ANIMATE' | 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT';
    duration: number;
    easing: {
      type: 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT' | 'LINEAR' | 'EASE_IN_BACK' | 'EASE_OUT_BACK';
    };
  } | null;
}

export interface Trigger {
  type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' | 'ON_DRAG_START'
    | 'ON_DRAG_END' | 'MOUSE_ENTER' | 'MOUSE_LEAVE' | 'MOUSE_UP' | 'MOUSE_DOWN'
    | 'AFTER_TIMEOUT' | 'KEY_DOWN' | 'KEY_UP' | 'ON_MEDIA_HIT' | 'ON_MEDIA_END'
    | 'ON_SWAP' | 'ON_STATE_CHANGE' | 'ON_CLICK_OUTSIDE';
  delay?: number;
  keyCodes?: number[];
}

// Tool Parameters
export interface SmartSelectParams {
  query: string;
  scope?: 'page' | 'document';
  limit?: number;
}

export interface FindSimilarParams {
  targetId: string;
  threshold?: number;
  scope?: 'page' | 'document';
}

export interface BatchOperation {
  type: 'create' | 'modify' | 'delete' | 'clone';
  params: any;
}

export interface BatchCreateParams {
  operations: BatchOperation[];
  chunkSize?: number;
  continueOnError?: boolean;
}

export interface CreateComponentParams {
  nodeIds: string[];
  name?: string;
  organize?: boolean;
}

export interface CreateVariantSetParams {
  componentIds: string[];
  propertyName: string;
  propertyValues: string[];
}

export interface CreateInteractionParams {
  fromNodeId: string;
  toNodeId: string;
  trigger: Trigger;
  action: Omit<Action, 'destinationId'>;
}

export interface BatchConnectParams {
  connections: Array<{
    fromNodeId: string;
    toNodeId: string;
    trigger?: Trigger;
    action?: Omit<Action, 'destinationId'>;
  }>;
}

export interface AnalyzeResult {
  duplicates: Array<{
    groupId: string;
    nodes: string[];
    similarity: number;
  }>;
  suggestions: Array<{
    type: 'component' | 'variant' | 'style';
    targetNodes: string[];
    description: string;
  }>;
}

// Cross-Page Operations
export interface CrossPageOperation {
  sourcePageId: string;
  targetPageId?: string;
  nodeIds: string[];
  operation: 'copy' | 'move' | 'create_instance';
}

export interface FrameToComponentsParams {
  frameId: string;
  strategy: 'smart' | 'by_type' | 'by_name' | 'all_children';
  groupSimilar?: boolean;
  createVariants?: boolean;
  organizeOnPage?: boolean;
  minSize?: { width: number; height: number };
  excludeTypes?: NodeType[];
}

export interface DetachAndOrganizeParams {
  instanceIds: string[];
  deleteMainComponent?: boolean;
  organizeBy?: 'type' | 'name' | 'size' | 'page_location';
  createBackup?: boolean;
}

export interface CrossDocumentReference {
  fileKey: string;
  nodeId: string;
  action: 'import' | 'link' | 'create_instance' | 'copy';
}

// Message Types for Plugin Communication
export interface PluginMessage {
  type: string;
  id: string;
  payload?: any;
  error?: string;
}

export interface PluginResponse {
  id: string;
  result?: any;
  error?: string;
  progress?: {
    current: number;
    total: number;
    message: string;
  };
}

// Component Analysis Result
export interface ComponentAnalysisResult {
  frameId: string;
  frameName: string;
  totalChildren: number;
  componentCandidates: Array<{
    nodeId: string;
    name: string;
    type: NodeType;
    bounds: Rectangle;
    similarityGroup?: number;
    suggestedName: string;
  }>;
  similarGroups: Array<{
    groupId: number;
    nodes: string[];
    similarity: number;
    suggestedComponentName: string;
  }>;
  createdComponents?: Array<{
    componentId: string;
    name: string;
    sourceNodes: string[];
    instanceIds: string[];
  }>;
}
