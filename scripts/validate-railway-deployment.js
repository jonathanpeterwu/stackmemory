#!/usr/bin/env node

/**
 * Validate Railway deployment and check all services
 */

async function checkEndpoint(url, expectedKeys = []) {
  try {
    console.log(`\n📍 Checking: ${url}`);
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Response:`, JSON.stringify(data, null, 2));
    
    // Check for expected keys
    for (const key of expectedKeys) {
      if (key in data) {
        console.log(`  ✅ Found key: ${key}`);
      } else {
        console.log(`  ❌ Missing key: ${key}`);
      }
    }
    
    return { success: response.ok, data };
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testAuth(baseUrl) {
  console.log('\n🔐 Testing Authentication Endpoints:');
  
  // Test signup
  const signupData = {
    email: `test${Date.now()}@example.com`,
    password: 'TestPass123!',
    name: 'Test User'
  };
  
  console.log('\n📝 Testing POST /auth/signup');
  try {
    const response = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData)
    });
    
    const data = await response.json();
    console.log(`  Status: ${response.status}`);
    
    if (response.ok) {
      console.log('  ✅ Signup endpoint works!');
      console.log(`  Response:`, JSON.stringify(data, null, 2));
    } else {
      console.log('  ❌ Signup failed:', data.error || data.message);
    }
  } catch (error) {
    console.log('  ❌ Signup endpoint not available:', error.message);
  }
  
  // Test login
  console.log('\n🔑 Testing POST /auth/login');
  try {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: signupData.email,
        password: signupData.password
      })
    });
    
    const data = await response.json();
    console.log(`  Status: ${response.status}`);
    
    if (response.ok) {
      console.log('  ✅ Login endpoint works!');
      console.log(`  Token received:`, data.token ? 'Yes' : 'No');
      console.log(`  API Key:`, data.apiKey ? 'Yes' : 'No');
    } else {
      console.log('  ❌ Login failed:', data.error || data.message);
    }
  } catch (error) {
    console.log('  ❌ Login endpoint not available:', error.message);
  }
}

async function main() {
  const baseUrl = process.argv[2] || 'https://stackmemory-production.up.railway.app';
  
  console.log('🚀 StackMemory Railway Deployment Validator');
  console.log('==========================================');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  // Check root endpoint
  const root = await checkEndpoint(baseUrl, ['message', 'version', 'endpoints']);
  
  // Detect server type
  if (root.data?.message?.includes('Minimal')) {
    console.log('\n⚠️  WARNING: Minimal server is running!');
    console.log('   The full server with auth endpoints is not deployed.');
  } else if (root.data?.message?.includes('API Server')) {
    console.log('\n✅ Full API server is running!');
  }
  
  // Check health
  await checkEndpoint(`${baseUrl}/health`, ['status']);
  
  // Check database connections
  const dbTest = await checkEndpoint(`${baseUrl}/test-db`, ['postgresql', 'redis']);
  
  if (dbTest.data) {
    console.log('\n📊 Database Status:');
    if (dbTest.data.postgresql?.status === 'connected') {
      console.log('  ✅ PostgreSQL: Connected');
    } else {
      console.log('  ❌ PostgreSQL:', dbTest.data.postgresql?.status || 'Not configured');
    }
    
    if (dbTest.data.redis?.status === 'connected') {
      console.log('  ✅ Redis: Connected');
    } else {
      console.log('  ❌ Redis:', dbTest.data.redis?.status || 'Not configured');
    }
  }
  
  // Test auth endpoints
  await testAuth(baseUrl);
  
  console.log('\n==========================================');
  console.log('Validation complete!');
}

main().catch(console.error);