#!/usr/bin/env node

// Simple Claude API wrapper that mimics the Claude CLI interface
// but uses the Anthropic API directly with the API key from environment

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Get API key from environment
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
let prompt = '';
let printMode = false;
let outputFormat = 'text';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--print') {
    printMode = true;
  } else if (args[i] === '--output-format') {
    outputFormat = args[++i];
  } else if (args[i] === '--dangerously-skip-permissions') {
    // Ignore this flag
  } else if (!args[i].startsWith('-')) {
    // This is the prompt
    prompt = args.slice(i).join(' ');
    break;
  }
}

// If no prompt provided, read from stdin
if (!prompt) {
  prompt = fs.readFileSync(0, 'utf-8');
}

if (!prompt) {
  console.error('Error: No prompt provided');
  process.exit(1);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: apiKey,
});

// Main function to call the API
async function callClaude() {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Output based on format
    if (outputFormat === 'json' || outputFormat === 'stream-json') {
      console.log(JSON.stringify({
        structured_output: {
          content: message.content[0].text,
          model: message.model,
          usage: message.usage
        }
      }));
    } else {
      // Text output
      console.log(message.content[0].text);
    }

  } catch (error) {
    console.error('Error calling Claude API:', error.message);
    process.exit(1);
  }
}

callClaude();