import autocannon from 'autocannon';
import { performance } from 'perf_hooks';

/**
 * Load Testing Framework for Data Layer
 * 
 * TARGETS (Phase 2 Exit Criteria):
 * - Message history: p95 ≤ 350ms at 100+ req/s
 * - Message send: p95 ≤ 250ms at 100+ req/s
 * - Connection scaling: 5k → 10k concurrent connections
 * - Pool saturation: < 80% under sustained load
 * - Cache hit ratio: > 70% after warmup
 * - Replica lag: < 5 seconds consistently
 * 
 * LOAD PROFILE:
 * - Ramp: 0 → 5k connections over 2 minutes
 * - Sustain: 5k connections for 5 minutes
 * - Spike: 5k → 10k for 1 minute
 * - Sustain: 10k connections for 5 minutes
 * - Ramp down: 10k → 0 over 1 minute
 * 
 * MONITORING:
 * - Query duration (p50, p95, p99)
 * - Pool saturation (db_connections_used / db_connections_total)
 * - Cache hit ratio (cache_hits / cache_requests)
 * - Replica lag (replica_lag_seconds)
 * - Error rate (errors / total_requests)
 */

export interface LoadTestConfig {
  name: string;
  url: string;
  connections: number;
  duration: number; // seconds
  pipelining: number;
  requests?: AutocannonRequest[];
  warmup?: boolean;
  expectedP95Ms: number;
  expectedThroughput: number; // req/s
}

export interface AutocannonRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  setupRequest?: (requestParams: any) => any;
}

export interface LoadTestResult {
  name: string;
  duration: number;
  connections: number;
  throughput: number; // req/s
  latency: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  requests: {
    total: number;
    sent: number;
    completed: number;
  };
  errors: number;
  timeouts: number;
  success: boolean; // Met SLO targets
  metrics: {
    poolSaturation?: number;
    cacheHitRatio?: number;
    replicaLag?: number;
  };
}

export class LoadTestRunner {
  /**
   * Run load test scenario
   */
  static async run(config: LoadTestConfig): Promise<LoadTestResult> {
    console.log(`\n🔥 Starting load test: ${config.name}`);
    console.log(`   Connections: ${config.connections}`);
    console.log(`   Duration: ${config.duration}s`);
    console.log(`   Target P95: ${config.expectedP95Ms}ms`);
    console.log(`   Target Throughput: ${config.expectedThroughput} req/s`);
    
    // Warmup phase
    if (config.warmup) {
      console.log('\n🔥 Warmup phase (30s)...');
      await this.runAutocannon({
        ...config,
        duration: 30,
        connections: Math.floor(config.connections / 2),
      });
    }
    
    // Main load test
    console.log('\n🔥 Main load test...');
    const startTime = performance.now();
    const result = await this.runAutocannon(config);
    const endTime = performance.now();
    
    // Fetch metrics from Prometheus
    const metrics = await this.fetchMetrics();
    
    // Calculate results
    const loadTestResult: LoadTestResult = {
      name: config.name,
      duration: (endTime - startTime) / 1000,
      connections: config.connections,
      throughput: result.requests.average,
      latency: {
        mean: result.latency.mean,
        p50: result.latency.p50,
        p95: result.latency.p95,
        p99: result.latency.p99,
        max: result.latency.max,
      },
      requests: {
        total: result.requests.total,
        sent: result.requests.sent,
        completed: result.requests.total - result.errors - result.timeouts,
      },
      errors: result.errors,
      timeouts: result.timeouts,
      success: this.evaluateSuccess(result, config, metrics),
      metrics,
    };
    
    // Print results
    this.printResults(loadTestResult, config);
    
    return loadTestResult;
  }
  
  /**
   * Run autocannon load test
   */
  private static async runAutocannon(config: LoadTestConfig): Promise<any> {
    return new Promise((resolve, reject) => {
      const instance = autocannon(
        {
          url: config.url,
          connections: config.connections,
          duration: config.duration,
          pipelining: config.pipelining,
          requests: config.requests,
        },
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
      
      autocannon.track(instance, { renderProgressBar: true });
    });
  }
  
  /**
   * Fetch metrics from Prometheus
   */
  private static async fetchMetrics(): Promise<any> {
    try {
      const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
      
      // Fetch pool saturation
      const poolSaturationResponse = await fetch(
        `${prometheusUrl}/api/v1/query?query=db_pool_saturation`
      );
      const poolSaturationData = await poolSaturationResponse.json();
      const poolSaturation =
        poolSaturationData.data?.result?.[0]?.value?.[1] || 0;
      
      // Fetch cache hit ratio
      const cacheHitResponse = await fetch(
        `${prometheusUrl}/api/v1/query?query=rate(cache_operation_total{result="hit"}[5m]) / rate(cache_operation_total[5m])`
      );
      const cacheHitData = await cacheHitResponse.json();
      const cacheHitRatio = cacheHitData.data?.result?.[0]?.value?.[1] || 0;
      
      // Fetch replica lag
      const replicaLagResponse = await fetch(
        `${prometheusUrl}/api/v1/query?query=replica_lag_seconds`
      );
      const replicaLagData = await replicaLagResponse.json();
      const replicaLag = replicaLagData.data?.result?.[0]?.value?.[1] || 0;
      
      return {
        poolSaturation: parseFloat(poolSaturation),
        cacheHitRatio: parseFloat(cacheHitRatio),
        replicaLag: parseFloat(replicaLag),
      };
    } catch (error) {
      console.warn('Failed to fetch metrics from Prometheus:', error);
      return {};
    }
  }
  
  /**
   * Evaluate if load test met success criteria
   */
  private static evaluateSuccess(
    result: any,
    config: LoadTestConfig,
    metrics: any
  ): boolean {
    const checks = {
      p95Latency: result.latency.p95 <= config.expectedP95Ms,
      throughput: result.requests.average >= config.expectedThroughput,
      errorRate: result.errors / result.requests.total < 0.01, // <1% error rate
      poolSaturation: !metrics.poolSaturation || metrics.poolSaturation < 0.80, // <80%
      cacheHitRatio: !metrics.cacheHitRatio || metrics.cacheHitRatio > 0.70, // >70%
      replicaLag: !metrics.replicaLag || metrics.replicaLag < 5, // <5s
    };
    
    return Object.values(checks).every((check) => check);
  }
  
  /**
   * Print load test results
   */
  private static printResults(result: LoadTestResult, config: LoadTestConfig): void {
    console.log('\n📊 Load Test Results:');
    console.log('='.repeat(60));
    console.log(`Test: ${result.name}`);
    console.log(`Duration: ${result.duration.toFixed(2)}s`);
    console.log(`Connections: ${result.connections}`);
    console.log('');
    console.log('Throughput:');
    console.log(`  Average: ${result.throughput.toFixed(2)} req/s`);
    console.log(`  Target: ${config.expectedThroughput} req/s`);
    console.log(`  ${result.throughput >= config.expectedThroughput ? '✅' : '❌'} ${result.throughput >= config.expectedThroughput ? 'PASS' : 'FAIL'}`);
    console.log('');
    console.log('Latency:');
    console.log(`  Mean: ${result.latency.mean.toFixed(2)}ms`);
    console.log(`  P50: ${result.latency.p50.toFixed(2)}ms`);
    console.log(`  P95: ${result.latency.p95.toFixed(2)}ms (target: ${config.expectedP95Ms}ms)`);
    console.log(`  P99: ${result.latency.p99.toFixed(2)}ms`);
    console.log(`  Max: ${result.latency.max.toFixed(2)}ms`);
    console.log(`  ${result.latency.p95 <= config.expectedP95Ms ? '✅' : '❌'} ${result.latency.p95 <= config.expectedP95Ms ? 'PASS' : 'FAIL'}`);
    console.log('');
    console.log('Requests:');
    console.log(`  Total: ${result.requests.total}`);
    console.log(`  Completed: ${result.requests.completed}`);
    console.log(`  Errors: ${result.errors}`);
    console.log(`  Timeouts: ${result.timeouts}`);
    console.log(`  Error Rate: ${((result.errors / result.requests.total) * 100).toFixed(2)}%`);
    console.log('');
    
    if (Object.keys(result.metrics).length > 0) {
      console.log('Metrics:');
      if (result.metrics.poolSaturation !== undefined) {
        console.log(`  Pool Saturation: ${(result.metrics.poolSaturation * 100).toFixed(1)}%`);
        console.log(`    ${result.metrics.poolSaturation < 0.80 ? '✅' : '❌'} ${result.metrics.poolSaturation < 0.80 ? 'PASS' : 'FAIL'} (target: <80%)`);
      }
      if (result.metrics.cacheHitRatio !== undefined) {
        console.log(`  Cache Hit Ratio: ${(result.metrics.cacheHitRatio * 100).toFixed(1)}%`);
        console.log(`    ${result.metrics.cacheHitRatio > 0.70 ? '✅' : '❌'} ${result.metrics.cacheHitRatio > 0.70 ? 'PASS' : 'FAIL'} (target: >70%)`);
      }
      if (result.metrics.replicaLag !== undefined) {
        console.log(`  Replica Lag: ${result.metrics.replicaLag.toFixed(2)}s`);
        console.log(`    ${result.metrics.replicaLag < 5 ? '✅' : '❌'} ${result.metrics.replicaLag < 5 ? 'PASS' : 'FAIL'} (target: <5s)`);
      }
      console.log('');
    }
    
    console.log('='.repeat(60));
    console.log(`Overall: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(60));
  }
  
  /**
   * Run progressive load test (ramp up)
   */
  static async runProgressive(
    baseConfig: LoadTestConfig,
    stages: Array<{ connections: number; duration: number }>
  ): Promise<LoadTestResult[]> {
    const results: LoadTestResult[] = [];
    
    console.log('\n🚀 Progressive Load Test');
    console.log(`   Stages: ${stages.length}`);
    
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      console.log(`\n📈 Stage ${i + 1}/${stages.length}: ${stage.connections} connections for ${stage.duration}s`);
      
      const result = await this.run({
        ...baseConfig,
        name: `${baseConfig.name} - Stage ${i + 1}`,
        connections: stage.connections,
        duration: stage.duration,
        warmup: i === 0 ? baseConfig.warmup : false, // Only warmup on first stage
      });
      
      results.push(result);
      
      // Fail fast if stage doesn't meet criteria
      if (!result.success) {
        console.log(`\n❌ Stage ${i + 1} failed. Aborting progressive load test.`);
        break;
      }
      
      // Cool down between stages
      if (i < stages.length - 1) {
        console.log('\n⏸️  Cool down (10s)...');
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
    
    return results;
  }
}

/**
 * Phase 2 Load Test Scenarios
 */
export const Phase2LoadTests = {
  /**
   * Scenario 1: Message History (Read-Heavy)
   */
  messageHistory: {
    name: 'Message History (Read-Heavy)',
    url: 'http://localhost:3000',
    connections: 5000,
    duration: 300, // 5 minutes
    pipelining: 10,
    warmup: true,
    expectedP95Ms: 350,
    expectedThroughput: 100,
    requests: [
      {
        method: 'GET',
        path: '/api/messages/history',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        setupRequest: (requestParams: any) => {
          requestParams.path = `/api/messages/history?conversationId=conv-${Math.floor(Math.random() * 1000)}&limit=50`;
          return requestParams;
        },
      },
    ],
  } as LoadTestConfig,
  
  /**
   * Scenario 2: Message Send (Write-Heavy)
   */
  messageSend: {
    name: 'Message Send (Write-Heavy)',
    url: 'http://localhost:3000',
    connections: 5000,
    duration: 300,
    pipelining: 5,
    warmup: true,
    expectedP95Ms: 250,
    expectedThroughput: 100,
    requests: [
      {
        method: 'POST',
        path: '/api/messages/send',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          conversationId: 'conv-test',
          content: 'Load test message',
        }),
      },
    ],
  } as LoadTestConfig,
  
  /**
   * Scenario 3: Mixed Workload (70% Read, 30% Write)
   */
  mixedWorkload: {
    name: 'Mixed Workload (70/30 Read/Write)',
    url: 'http://localhost:3000',
    connections: 8000,
    duration: 300,
    pipelining: 8,
    warmup: true,
    expectedP95Ms: 300,
    expectedThroughput: 150,
    requests: [
      // 70% reads
      ...Array(7).fill({
        method: 'GET',
        path: '/api/messages/history',
        headers: { 'Authorization': 'Bearer test-token' },
        setupRequest: (requestParams: any) => {
          requestParams.path = `/api/messages/history?conversationId=conv-${Math.floor(Math.random() * 1000)}`;
          return requestParams;
        },
      }),
      // 30% writes
      ...Array(3).fill({
        method: 'POST',
        path: '/api/messages/send',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          conversationId: 'conv-test',
          content: 'Load test message',
        }),
      }),
    ],
  } as LoadTestConfig,
  
  /**
   * Scenario 4: Spike Test (5k → 10k connections)
   */
  spikeTest: async () => {
    const baseConfig = Phase2LoadTests.messageHistory;
    
    const stages = [
      { connections: 5000, duration: 120 }, // 2 min at 5k
      { connections: 10000, duration: 60 }, // 1 min spike to 10k
      { connections: 10000, duration: 300 }, // 5 min sustained at 10k
      { connections: 5000, duration: 60 }, // 1 min ramp down
    ];
    
    return LoadTestRunner.runProgressive(baseConfig, stages);
  },
};
