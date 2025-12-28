#!/usr/bin/env node
/**
 * Test script to verify tool call storage in the database
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

// Find .stackmemory directory
function findStackMemoryDir() {
  let dir = process.cwd();
  while (dir !== '/') {
    const stackMemoryDir = join(dir, '.stackmemory');
    if (existsSync(stackMemoryDir)) {
      return stackMemoryDir;
    }
    dir = join(dir, '..');
  }
  return null;
}

function main() {
  const stackMemoryDir = findStackMemoryDir();
  if (!stackMemoryDir) {
    console.log('❌ No .stackmemory directory found. Run stackmemory init first.');
    process.exit(1);
  }

  const dbPath = join(stackMemoryDir, 'context.db');
  if (!existsSync(dbPath)) {
    console.log('❌ No context.db found. Run the MCP server first.');
    process.exit(1);
  }

  console.log(`📂 Using database: ${dbPath}`);
  
  const db = new Database(dbPath);

  // Check if events table exists and has tool_call entries
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('📋 Available tables:', tables.map(t => t.name).join(', '));

    const eventsTableExists = tables.some(t => t.name === 'events');
    if (!eventsTableExists) {
      console.log('❌ Events table not found. The MCP server may not have been run yet.');
      process.exit(1);
    }

    // Get recent events
    const events = db.prepare(`
      SELECT event_type, payload, ts 
      FROM events 
      ORDER BY ts DESC 
      LIMIT 10
    `).all();

    console.log('\n📝 Recent Events:');
    events.forEach((event, index) => {
      const payload = JSON.parse(event.payload);
      const timestamp = new Date(event.ts * 1000).toLocaleString();
      console.log(`${index + 1}. [${event.event_type}] ${timestamp}`);
      
      if (event.event_type === 'tool_call') {
        console.log(`   🔧 Tool: ${payload.tool_name}`);
        console.log(`   📥 Args: ${JSON.stringify(payload.arguments, null, 2).substring(0, 100)}...`);
      } else if (event.event_type === 'tool_result') {
        console.log(`   🔧 Tool: ${payload.tool_name}`);
        console.log(`   ✅ Success: ${payload.success}`);
      } else {
        console.log(`   📄 ${JSON.stringify(payload, null, 2).substring(0, 100)}...`);
      }
      console.log('');
    });

    // Count tool calls
    const toolCallCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE event_type = 'tool_call'
    `).get();

    const toolResultCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE event_type = 'tool_result'
    `).get();

    console.log(`📊 Statistics:`);
    console.log(`   🔧 Tool calls logged: ${toolCallCount.count}`);
    console.log(`   📤 Tool results logged: ${toolResultCount.count}`);

    if (toolCallCount.count > 0) {
      console.log('✅ Tool call storage is working correctly!');
    } else {
      console.log('⚠️  No tool calls found. Try using the MCP server tools in Claude Code.');
      console.log('   Example: Use the start_frame or get_context tools to generate some events.');
    }

  } catch (error) {
    console.error('❌ Error querying database:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();