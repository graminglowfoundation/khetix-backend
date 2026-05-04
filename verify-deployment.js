#!/usr/bin/env node

/**
 * Deployment Verification Script
 * 
 * Tests all critical endpoints after deployment to ensure everything is working.
 * 
 * Usage:
 *   node verify-deployment.js https://your-app-name.onrender.com
 */

const API_URL = process.argv[2] || 'http://localhost:5000';

console.log('\n🔍 Testing KhetiX Backend Deployment...\n');
console.log(`📡 API URL: ${API_URL}\n`);

const tests = [
  {
    name: 'Health Check',
    endpoint: '/api/health',
    expectedStatus: 200,
    expectedFields: ['success', 'status', 'uptime'],
  },
  {
    name: 'API Info',
    endpoint: '/api',
    expectedStatus: 200,
    expectedFields: ['success', 'message', 'endpoints'],
  },
  {
    name: 'Root Endpoint',
    endpoint: '/',
    expectedStatus: 200,
    expectedFields: ['success', 'message', 'apiBaseUrl'],
  },
  {
    name: 'Invalid Route (404)',
    endpoint: '/api/invalid-route',
    expectedStatus: 404,
    expectedFields: ['success', 'message'],
  },
];

async function runTest(test) {
  try {
    const url = `${API_URL}${test.endpoint}`;
    const response = await fetch(url);
    const data = await response.json();

    const statusMatch = response.status === test.expectedStatus;
    const fieldsMatch = test.expectedFields.every(field => field in data);

    if (statusMatch && fieldsMatch) {
      console.log(`✅ ${test.name}`);
      return true;
    } else {
      console.log(`❌ ${test.name}`);
      if (!statusMatch) console.log(`   Expected status ${test.expectedStatus}, got ${response.status}`);
      if (!fieldsMatch) console.log(`   Missing fields: ${test.expectedFields.filter(f => !(f in data)).join(', ')}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ ${test.name}`);
    console.log(`   Error: ${err.message}`);
    return false;
  }
}

async function main() {
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);
    if (result) passed++;
    else failed++;
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed! Your backend is ready.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check the logs above.\n');
    process.exit(1);
  }
}

main();
