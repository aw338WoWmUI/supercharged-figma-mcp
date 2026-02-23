#!/bin/bash
# Setup MCP configuration for all supported clients (project scope)
# Usage: ./setup-mcp.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/dist/server.js"
RELAY_URL="wss://supercharged-figma-relay.gpw2333.workers.dev/supercharged-figma/ws"
MCP_HTTP_URL="https://supercharged-figma-relay.gpw2333.workers.dev/mcp"

echo "Setting up project-scoped MCP configuration..."
echo "Project: $SCRIPT_DIR"
echo "Server path: $SERVER_PATH"
echo "Relay URL: $RELAY_URL"
echo ""

# Project-local output files
PROJECT_MCP_JSON_DIR="$SCRIPT_DIR/.config/mcp"
PROJECT_KIMI_DIR="$SCRIPT_DIR/.config/kimi"
PROJECT_CURSOR_DIR="$SCRIPT_DIR/.cursor"
PROJECT_CLAUDE_FILE="$SCRIPT_DIR/.claude.json"
PROJECT_MCP_JSON_FILE="$PROJECT_MCP_JSON_DIR/figma.json"

# Create directories
mkdir -p "$PROJECT_MCP_JSON_DIR" "$PROJECT_KIMI_DIR" "$PROJECT_CURSOR_DIR"

# Create unified JSON config (command mode, remote relay)
JSON_CONFIG="{
  \"mcpServers\": {
    \"supercharged-figma\": {
      \"command\": \"node\",
      \"args\": [
        \"$SERVER_PATH\",
        \"--remote\",
        \"$RELAY_URL\"
      ],
      \"env\": {}
    }
  }
}"

echo "$JSON_CONFIG" > "$PROJECT_MCP_JSON_FILE"
echo "✓ Created $PROJECT_MCP_JSON_FILE"

# Link to Cursor (project scope)
ln -sf "$PROJECT_MCP_JSON_FILE" "$PROJECT_CURSOR_DIR/mcp.json"
echo "✓ Linked to $PROJECT_CURSOR_DIR/mcp.json"

# Link to Kimi (project scope)
ln -sf "$PROJECT_MCP_JSON_FILE" "$PROJECT_KIMI_DIR/mcp.json"
echo "✓ Linked to $PROJECT_KIMI_DIR/mcp.json"

# Create project Claude MCP config file
CLAUDE_JSON_CONFIG="{
  \"mcpServers\": {
    \"supercharged-figma\": {
      \"url\": \"$MCP_HTTP_URL\"
    }
  }
}"
echo "$CLAUDE_JSON_CONFIG" > "$PROJECT_CLAUDE_FILE"
echo "✓ Created $PROJECT_CLAUDE_FILE"


echo ""
echo "Setup complete! 🎉"
echo ""
echo "Next steps:"
echo "1. Start the relay server: node relay-server.js"
echo "2. Restart your AI client (Cursor/Kimi/Codex/Claude)"
echo "3. Connect Figma plugin and copy Channel Code"
echo "4. Ask AI: 'Connect to Figma with channel code XXXXXXXX'"
