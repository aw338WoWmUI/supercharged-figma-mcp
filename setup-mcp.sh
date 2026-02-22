#!/bin/bash
# Setup MCP configuration for all supported clients
# Usage: ./setup-mcp.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/dist/server.js"
RELAY_URL="ws://localhost:8080"

echo "Setting up MCP configuration for all clients..."
echo "Server path: $SERVER_PATH"
echo "Relay URL: $RELAY_URL"
echo ""

# Create directories
mkdir -p ~/.config/mcp
mkdir -p ~/.config/kimi
mkdir -p ~/.cursor
mkdir -p ~/.codex

# Create unified JSON config
JSON_CONFIG="{
  \"mcpServers\": {
    \"supercharged-figma\": {
      \"command\": \"node\",
      \"args\": [
        \"$SERVER_PATH\",
        \"--relay-server=$RELAY_URL\"
      ],
      \"env\": {}
    }
  }
}"

echo "$JSON_CONFIG" > ~/.config/mcp/figma.json
echo "✓ Created ~/.config/mcp/figma.json"

# Link to Cursor
ln -sf ~/.config/mcp/figma.json ~/.cursor/mcp.json
echo "✓ Linked to ~/.cursor/mcp.json"

# Link to Kimi
ln -sf ~/.config/mcp/figma.json ~/.config/kimi/mcp.json
echo "✓ Linked to ~/.config/kimi/mcp.json"

# Create Codex TOML config
TOML_CONFIG="# OpenAI Codex MCP Configuration
[mcp_servers.supercharged-figma]
command = \"node\"
args = [\"$SERVER_PATH\", \"--relay-server=$RELAY_URL\"]
"

echo "$TOML_CONFIG" > ~/.codex/config.toml
echo "✓ Created ~/.codex/config.toml"

# Create Claude Desktop config (Mac)
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$CLAUDE_DIR" ]; then
    echo "$JSON_CONFIG" > "$CLAUDE_DIR/claude_desktop_config.json"
    echo "✓ Created Claude Desktop config"
fi

echo ""
echo "Setup complete! 🎉"
echo ""
echo "Next steps:"
echo "1. Start the relay server: node relay-server.js"
echo "2. Restart your AI client (Cursor/Kimi/Codex/Claude)"
echo "3. Connect Figma plugin and copy Channel Code"
echo "4. Ask AI: 'Connect to Figma with channel code XXXXXXXX'"
