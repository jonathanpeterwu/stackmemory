#!/usr/bin/env node

/**
 * Track Claude session activity
 * Called by other hooks to mark when Claude is actively being used
 */

import fs from 'fs';
import path from 'path';

function trackActivity() {
  try {
    const activityFile = path.join(process.env.HOME, '.stackmemory', '.claude-activity');
    const dir = path.dirname(activityFile);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(activityFile, new Date().toISOString());
  } catch (error) {
    // Silent fail - don't block other hooks
  }
}

// Export for use in other hooks
export { trackActivity };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  trackActivity();
}