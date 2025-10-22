#!/usr/bin/env ts-node

import { Phase2LoadTests, LoadTestRunner } from './load-test-framework';

/**
 * Load Test Runner Script
 * 
 * Usage:
 *   npm run test:load -- --scenario=messageHistory
 *   npm run test:load -- --scenario=messageSend
 *   npm run test:load -- --scenario=mixed
 *   npm run test:load -- --scenario=spike
 *   npm run test:load -- --scenario=all
 * 
 * Prerequisites:
 * - Server running on http://localhost:3000
 * - Prometheus running on http://localhost:9090
 * - Database seeded with test data
 */

async function main() {
  const args = process.argv.slice(2);
  const scenarioArg = args.find((arg) => arg.startsWith('--scenario='));
  const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'all';
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       Phase 2 Data Layer Load Testing Suite              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  try {
    // Check prerequisites
    await checkPrerequisites();
    
    const results: any[] = [];
    
    switch (scenario) {
      case 'messageHistory':
        console.log('\n🔥 Running Message History (Read-Heavy) Load Test...');
        results.push(await LoadTestRunner.run(Phase2LoadTests.messageHistory));
        break;
        
      case 'messageSend':
        console.log('\n🔥 Running Message Send (Write-Heavy) Load Test...');
        results.push(await LoadTestRunner.run(Phase2LoadTests.messageSend));
        break;
        
      case 'mixed':
        console.log('\n🔥 Running Mixed Workload Load Test...');
        results.push(await LoadTestRunner.run(Phase2LoadTests.mixedWorkload));
        break;
        
      case 'spike':
        console.log('\n🔥 Running Spike Test (5k → 10k connections)...');
        const spikeResults = await Phase2LoadTests.spikeTest();
        results.push(...spikeResults);
        break;
        
      case 'all':
        console.log('\n🔥 Running All Load Test Scenarios...');
        
        console.log('\n\n1️⃣  Message History (Read-Heavy)');
        results.push(await LoadTestRunner.run(Phase2LoadTests.messageHistory));
        
        await cooldown(30);
        
        console.log('\n\n2️⃣  Message Send (Write-Heavy)');
        results.push(await LoadTestRunner.run(Phase2LoadTests.messageSend));
        
        await cooldown(30);
        
        console.log('\n\n3️⃣  Mixed Workload (70/30)');
        results.push(await LoadTestRunner.run(Phase2LoadTests.mixedWorkload));
        
        await cooldown(60);
        
        console.log('\n\n4️⃣  Spike Test (5k → 10k)');
        const allSpikeResults = await Phase2LoadTests.spikeTest();
        results.push(...allSpikeResults);
        
        break;
        
      default:
        console.error(`\n❌ Unknown scenario: ${scenario}`);
        console.log('   Valid scenarios: messageHistory, messageSend, mixed, spike, all');
        process.exit(1);
    }
    
    // Summary
    printSummary(results);
    
    // Exit with appropriate code
    const allPassed = results.every((r) => r.success);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Load test failed:', error);
    process.exit(1);
  }
}

/**
 * Check prerequisites before running load tests
 */
async function checkPrerequisites(): Promise<void> {
  console.log('\n🔍 Checking prerequisites...');
  
  // Check server
  try {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const response = await fetch(`${serverUrl}/health`);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    console.log('   ✅ Server is running');
  } catch (error) {
    console.error('   ❌ Server is not accessible');
    console.error('      Start server with: npm run start');
    throw error;
  }
  
  // Check Prometheus
  try {
    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    const response = await fetch(`${prometheusUrl}/-/healthy`);
    if (!response.ok) {
      throw new Error(`Prometheus returned ${response.status}`);
    }
    console.log('   ✅ Prometheus is running');
  } catch (error) {
    console.warn('   ⚠️  Prometheus is not accessible (metrics will be unavailable)');
    console.warn('      Start Prometheus with: docker-compose up -d prometheus');
  }
  
  console.log('');
}

/**
 * Cool down between test scenarios
 */
async function cooldown(seconds: number): Promise<void> {
  console.log(`\n⏸️  Cooling down for ${seconds}s...`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Print summary of all test results
 */
function printSummary(results: any[]): void {
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Load Test Summary                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  
  console.log('Results:');
  results.forEach((result, index) => {
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'PASS' : 'FAIL';
    console.log(`  ${icon} ${result.name}`);
    console.log(`     Throughput: ${result.throughput.toFixed(2)} req/s`);
    console.log(`     P95 Latency: ${result.latency.p95.toFixed(2)}ms`);
    console.log(`     Status: ${status}`);
    console.log('');
  });
  
  console.log('═'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('═'.repeat(60));
  
  if (failed === 0) {
    console.log('\n🎉 All load tests passed! Phase 2 data layer is ready for rollout.');
  } else {
    console.log('\n❌ Some load tests failed. Review results and tune configuration.');
  }
}

// Run load tests
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
