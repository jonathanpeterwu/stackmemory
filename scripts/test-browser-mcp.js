#!/usr/bin/env node

/**
 * Browser MCP Test Script
 * Tests the Browser MCP integration for browser automation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testBrowserMCP() {
  console.log('🌐 Testing Browser MCP Server...\n');

  try {
    // Create client transport
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['/opt/homebrew/lib/node_modules/@browsermcp/mcp/dist/index.js'],
    });

    // Create MCP client
    const client = new Client({
      name: 'browser-mcp-test',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    // Connect to server
    await client.connect(transport);
    console.log('✅ Connected to Browser MCP server\n');

    // List available tools
    const tools = await client.listTools();
    console.log('📦 Available tools:', tools.tools?.length || 0);
    if (tools.tools) {
      tools.tools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
    }
    console.log();

    // Example: Navigate to a page
    console.log('🧪 Testing browser navigation...');
    try {
      const result = await client.callTool('browser_navigate', {
        url: 'https://example.com'
      });
      console.log('✅ Navigation successful:', result);
    } catch (error) {
      console.log('⚠️  Navigation test failed:', error.message);
    }

    // Example: Take screenshot
    console.log('\n🧪 Testing screenshot capture...');
    try {
      const screenshot = await client.callTool('browser_screenshot', {});
      console.log('✅ Screenshot captured');
    } catch (error) {
      console.log('⚠️  Screenshot test failed:', error.message);
    }

    // Close connection
    await client.close();
    console.log('\n✅ Browser MCP test complete!');

  } catch (error) {
    console.error('❌ Error testing Browser MCP:', error);
    process.exit(1);
  }
}

// Run test
testBrowserMCP().catch(console.error);