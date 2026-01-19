#!/usr/bin/env node

/**
 * Test code execution MCP handler
 */

import { CodeExecutionHandler } from '../dist/integrations/mcp/handlers/code-execution-handlers.js';

async function testPythonExecution() {
  console.log('🐍 Testing Python Code Execution\n');
  
  const handler = new CodeExecutionHandler();
  
  // Test 1: Simple Python code
  console.log('Test 1: Simple calculation');
  const result1 = await handler.executeCode({
    language: 'python',
    code: `
import math

def calculate_circle_area(radius):
    return math.pi * radius ** 2

# Test the function
radius = 5
area = calculate_circle_area(radius)
print(f"Circle with radius {radius} has area: {area:.2f}")

# Generate some data
data = [i**2 for i in range(10)]
print(f"Squares: {data}")
`,
  });
  
  console.log('Success:', result1.success);
  console.log('Output:', result1.stdout);
  if (result1.stderr) console.log('Errors:', result1.stderr);
  console.log('---\n');
  
  // Test 2: Code with warnings
  console.log('Test 2: Code with security warnings');
  const code2 = `
import os
import subprocess

# This should trigger warnings
print("Current directory:", os.getcwd())
`;
  
  const validation = handler.validateCode(code2);
  console.log('Validation result:', validation);
  
  if (!validation.safe) {
    console.log('Executing anyway with force flag...');
    const result2 = await handler.executeCode({
      language: 'python',
      code: code2,
    });
    console.log('Output:', result2.stdout);
  }
  console.log('---\n');
  
  // Test 3: JavaScript execution
  console.log('Test 3: JavaScript code');
  const result3 = await handler.executeCode({
    language: 'javascript',
    code: `
// Calculate fibonacci
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

for (let i = 0; i < 10; i++) {
  console.log(\`fibonacci(\${i}) = \${fibonacci(i)}\`);
}

// Test async operation
setTimeout(() => {
  console.log('Async operation completed');
}, 100);

// Wait a bit for async
new Promise(resolve => setTimeout(resolve, 200)).then(() => {
  console.log('Promise resolved');
});
`,
  });
  
  console.log('Success:', result3.success);
  console.log('Output:', result3.stdout);
  console.log('---\n');
  
  // Test 4: Long-running code with timeout
  console.log('Test 4: Timeout test');
  const result4 = await handler.executeCode({
    language: 'python',
    code: `
import time
print("Starting long operation...")
time.sleep(5)  # This should timeout if timeout is < 5 seconds
print("This should not print")
`,
    timeout: 2000, // 2 second timeout
  });
  
  console.log('Success:', result4.success);
  console.log('Output:', result4.stdout);
  console.log('Errors:', result4.stderr);
  console.log('---\n');
  
  // Test 5: Large output truncation
  console.log('Test 5: Large output handling');
  const result5 = await handler.executeCode({
    language: 'python',
    code: `
# Generate large output
for i in range(10000):
    print(f"Line {i}: {'=' * 50}")
`,
  });
  
  console.log('Success:', result5.success);
  console.log('Truncated:', result5.truncated);
  if (result5.truncated) {
    console.log('Output file:', result5.outputFile);
  }
  console.log('Output length:', result5.stdout.length);
  console.log('---\n');
  
  // Get sandbox status
  const status = await handler.getSandboxStatus();
  console.log('📊 Sandbox Status:', status);
  
  // Clean sandbox
  console.log('\n🧹 Cleaning sandbox...');
  await handler.cleanSandbox();
  const statusAfter = await handler.getSandboxStatus();
  console.log('Sandbox after cleanup:', statusAfter);
}

// Run tests
testPythonExecution().catch(console.error);