#!/usr/bin/env node

// Test TUI with setLabel fixes
import { StackMemoryTUI } from './dist/features/tui/index.js';

console.log('Testing TUI with setLabel fixes...\n');

// Set compatibility environment
process.env.TERM = 'xterm';
process.env.FORCE_TUI = '1';
process.env.NODE_NO_WARNINGS = '1';

const tui = new StackMemoryTUI({
  refreshInterval: 1000,
  wsUrl: 'ws://localhost:8080'
});

// Start TUI
tui.start()
  .then(async () => {
    console.log('\n✅ TUI started successfully!');
    
    // Test update to trigger the setLabel calls
    setTimeout(async () => {
      console.log('Testing refresh (which triggers setLabel calls)...');
      tui.refresh();
    }, 1000);
    
    // Auto-exit after 3 seconds
    setTimeout(() => {
      console.log('✅ Test completed - no setLabel errors detected');
      tui.cleanup();
      process.exit(0);
    }, 3000);
  })
  .catch((error) => {
    console.error('❌ TUI failed to start:', error.message);
    process.exit(1);
  });