import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request Logging Middleware
 * 
 * Logs all requests with request IDs for tracing, safe redaction of sensitive data,
 * and operational visibility. No authentication context is logged.
 * 
 * See: docs/operations/logging.md for log format and retention policies
 */

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

/**
 * Fields to redact from logs (never log sensitive data)
 */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'apiKey',
  'authorization',
  'cookie',
  'session',
  'secret',
  'creditCard',
  'ssn'
];

/**
 * Redact sensitive fields from objects
 */
function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
  
  for (const key in redacted) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }
  
  return redacted;
}

/**
 * Generate request ID and attach to request
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.headers['x-request-id'] as string || uuidv4();
  req.startTime = Date.now();
  
  // Add request ID to response headers for client tracing
  res.setHeader('X-Request-ID', req.requestId);
  
  next();
}

/**
 * Log incoming requests
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { method, originalUrl, ip, headers } = req;
  const requestId = req.requestId;
  const userId = (req.query.userId || req.body?.userId) as string | undefined;
  
  // Log request (safe, no sensitive data)
  console.log(JSON.stringify({
    type: 'request',
    requestId,
    timestamp: new Date().toISOString(),
    method,
    url: originalUrl,
    ip,
    userAgent: headers['user-agent'],
    userId: userId || 'anonymous', // Opaque metadata only
    referer: headers['referer'],
    contentType: headers['content-type'],
    contentLength: headers['content-length']
  }));
  
  // Capture response
  const originalSend = res.send;
  res.send = function (data: any): Response {
    const duration = Date.now() - (req.startTime || Date.now());
    
    // Log response
    console.log(JSON.stringify({
      type: 'response',
      requestId,
      timestamp: new Date().toISOString(),
      method,
      url: originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: userId || 'anonymous',
      ip
    }));
    
    return originalSend.call(this, data);
  };
  
  next();
}

/**
 * Log errors with full context
 */
export function errorLoggingMiddleware(error: Error, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.requestId;
  const userId = (req.query.userId || req.body?.userId) as string | undefined;
  
  console.error(JSON.stringify({
    type: 'error',
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: userId || 'anonymous',
    error: {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    },
    // Redact sensitive data from body/query
    body: redactSensitiveData(req.body),
    query: redactSensitiveData(req.query)
  }));
  
  next(error);
}

/**
 * Log metrics for monitoring
 */
export class MetricsCollector {
  private static requests: Map<string, number> = new Map();
  private static errors: Map<string, number> = new Map();
  private static latencies: number[] = [];
  private static connections = 0;
  
  static recordRequest(endpoint: string): void {
    const count = this.requests.get(endpoint) || 0;
    this.requests.set(endpoint, count + 1);
  }
  
  static recordError(endpoint: string): void {
    const count = this.errors.get(endpoint) || 0;
    this.errors.set(endpoint, count + 1);
  }
  
  static recordLatency(duration: number): void {
    this.latencies.push(duration);
    // Keep only last 1000 latencies
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }
  
  static incrementConnections(): void {
    this.connections++;
  }
  
  static decrementConnections(): void {
    this.connections--;
  }
  
  static getMetrics() {
    const totalRequests = Array.from(this.requests.values()).reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.errors.values()).reduce((a, b) => a + b, 0);
    const avgLatency = this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0;
    const p95Latency = this.latencies.length > 0
      ? this.latencies.sort((a, b) => a - b)[Math.floor(this.latencies.length * 0.95)]
      : 0;
    
    return {
      requests: {
        total: totalRequests,
        byEndpoint: Object.fromEntries(this.requests)
      },
      errors: {
        total: totalErrors,
        rate: totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) + '%' : '0%',
        byEndpoint: Object.fromEntries(this.errors)
      },
      latency: {
        average: Math.round(avgLatency),
        p95: Math.round(p95Latency),
        unit: 'ms'
      },
      connections: {
        active: this.connections
      },
      timestamp: new Date().toISOString()
    };
  }
  
  static reset(): void {
    this.requests.clear();
    this.errors.clear();
    this.latencies = [];
  }
}

/**
 * Metrics collection middleware
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.route?.path || req.path}`;
  
  MetricsCollector.recordRequest(endpoint);
  
  const originalSend = res.send;
  res.send = function (data: any): Response {
    const duration = Date.now() - (req.startTime || Date.now());
    MetricsCollector.recordLatency(duration);
    
    if (res.statusCode >= 400) {
      MetricsCollector.recordError(endpoint);
    }
    
    return originalSend.call(this, data);
  };
  
  next();
}

/**
 * Expose metrics endpoint for monitoring
 */
export function metricsEndpoint(req: Request, res: Response): void {
  res.json(MetricsCollector.getMetrics());
}
