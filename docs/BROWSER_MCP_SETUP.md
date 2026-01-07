# Browser MCP Setup Guide

## Installation

Browser MCP has been successfully installed and configured for your StackMemory project.

### 1. Global Installation
```bash
npm install -g @browsermcp/mcp
```

### 2. Claude Desktop Configuration
The Browser MCP server has been added to your Claude desktop configuration at:
`~/Library/Application Support/Claude/claude_desktop_config.json`

Configuration entry:
```json
"browsermcp": {
  "command": "node",
  "args": [
    "/opt/homebrew/lib/node_modules/@browsermcp/mcp/dist/index.js"
  ],
  "env": {}
}
```

### 3. Restart Claude Desktop
**Important:** You need to restart Claude Desktop for the Browser MCP server to be available.

## Usage

Once Claude Desktop is restarted, Browser MCP tools will be available for browser automation tasks including:

- Navigate to URLs
- Take screenshots
- Click elements
- Fill forms
- Extract page content
- Execute JavaScript
- Manage cookies
- Handle multiple tabs

## Testing

A test script has been created at `scripts/test-browser-mcp.js` to verify the Browser MCP integration:

```bash
node scripts/test-browser-mcp.js
```

## Browser MCP Tools Available

The following tools should be available in Claude after restart:

- `browser_navigate` - Navigate to a URL
- `browser_screenshot` - Take a screenshot of current page
- `browser_click` - Click on an element
- `browser_fill` - Fill form fields
- `browser_select` - Select dropdown options
- `browser_execute` - Execute JavaScript in page context
- `browser_get_content` - Extract page content
- `browser_wait` - Wait for elements or conditions
- `browser_close` - Close browser/tab

## Integration with StackMemory

Browser MCP can be used alongside StackMemory's context persistence to:
- Automate browser testing workflows
- Capture visual regression tests
- Extract data from web applications
- Automate form submissions
- Monitor web page changes

## Troubleshooting

If Browser MCP tools are not available after restart:

1. Check Claude Desktop logs for MCP server errors
2. Verify the installation path: `/opt/homebrew/lib/node_modules/@browsermcp/mcp/`
3. Test the server directly: `node /opt/homebrew/lib/node_modules/@browsermcp/mcp/dist/index.js --help`
4. Ensure Node.js is properly configured in your PATH

## Next Steps

1. Restart Claude Desktop
2. Test browser automation with simple commands
3. Integrate Browser MCP with your StackMemory workflows
4. Create automated testing scripts using both tools together