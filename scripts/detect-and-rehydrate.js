#!/usr/bin/env node

/**
 * Smart Compaction Detection and Auto-Rehydration
 * Monitors Claude Code context and triggers rehydration when needed
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Compaction detection patterns
const COMPACTION_INDICATORS = [
  'earlier in this conversation',
  'previously discussed',
  'as mentioned before', 
  'summarized for brevity',
  '[conversation compressed]',
  '[context truncated]',
  '⏺ Compact summary',
  'Previous Conversation Compacted',
  'Referenced file',
  /⎿.*Referenced file/,
  /⎿.*Read.*\(\d+ lines\)/
];

class CompactionDetector {
  constructor() {
    this.logFile = path.join(process.cwd(), '.stackmemory', 'compaction.log');
    this.lastCheck = 0;
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: ${message}\n`;
    
    console.log(`🔍 ${message}`);
    
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write to log:', error.message);
    }
  }

  async detectCompaction(inputText) {
    if (!inputText) return false;

    const lowerText = inputText.toLowerCase();
    
    // Check for exact string matches
    const hasStringIndicator = COMPACTION_INDICATORS.some(indicator => {
      if (typeof indicator === 'string') {
        return lowerText.includes(indicator.toLowerCase());
      } else if (indicator instanceof RegExp) {
        return indicator.test(inputText);
      }
      return false;
    });

    // Check for compact summary patterns
    const hasCompactPattern = /⏺.*compact summary|compact.*summary/i.test(inputText);
    
    // Check for conversation compression indicators  
    const hasCompressionPattern = /previous conversation.*compacted|context.*truncated/i.test(inputText);

    // Check for file reference patterns (common after compaction)
    const hasFileReferencePattern = /⎿.*referenced file|⎿.*read.*\(\d+ lines\)/i.test(inputText);

    return hasStringIndicator || hasCompactPattern || hasCompressionPattern || hasFileReferencePattern;
  }

  async triggerRehydration() {
    this.log('Compaction detected, triggering context rehydration...');

    try {
      // Check if StackMemory is available
      await execAsync('stackmemory status');
      
      // Check for existing checkpoints
      const { stdout: listOutput } = await execAsync('stackmemory context rehydrate --list');
      
      if (listOutput.includes('No rehydration checkpoints')) {
        this.log('No checkpoints found, creating initial checkpoint...');
        await execAsync('stackmemory context rehydrate --create');
        this.log('Initial checkpoint created');
      }

      // Perform rehydration
      this.log('Performing context rehydration...');
      const { stdout: rehydrateOutput } = await execAsync('stackmemory context rehydrate --verbose');
      
      this.log('Context rehydration completed successfully');
      console.log('\n✅ Rich context restored! Your session now includes:');
      console.log('   📁 File snapshots with content previews');
      console.log('   🗺️  Project structure and relationships');
      console.log('   🧠 Previous decisions and reasoning');
      console.log('   🎯 Active workflows and focus areas\n');

      return true;

    } catch (error) {
      this.log(`Context rehydration failed: ${error.message}`);
      console.error('❌ Failed to rehydrate context:', error.message);
      return false;
    }
  }

  async checkInput(text) {
    if (await this.detectCompaction(text)) {
      // Debounce multiple detections
      const now = Date.now();
      if (now - this.lastCheck < 30000) { // 30 second cooldown
        this.log('Compaction detected but within cooldown period, skipping...');
        return;
      }
      
      this.lastCheck = now;
      await this.triggerRehydration();
    }
  }
}

// CLI usage
async function main() {
  const detector = new CompactionDetector();

  if (process.argv.length > 2) {
    // Check specific text
    const text = process.argv.slice(2).join(' ');
    const detected = await detector.detectCompaction(text);
    console.log(`Compaction detected: ${detected}`);
    
    if (detected) {
      await detector.triggerRehydration();
    }
  } else {
    // Monitor mode (could be enhanced to monitor clipboard, files, etc.)
    console.log('📡 StackMemory Compaction Detector Ready');
    console.log('💡 Usage: node detect-and-rehydrate.js "text to check"');
    console.log('🔧 Integrate with Claude Code hooks for automatic detection');
  }
}

// Export for use as module
module.exports = { CompactionDetector };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}