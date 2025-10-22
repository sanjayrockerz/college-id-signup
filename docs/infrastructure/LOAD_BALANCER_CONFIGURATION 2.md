# Load Balancer Configuration Guide

**Role**: Edge infrastructure ensuring stable long-lived WebSocket connections at scale  
**Scope**: LB configuration, sticky sessions, health checks, timeouts, and graceful failover  
**Last Updated**: 2025-10-22

---

## Table of Contents

1. [Overview](#overview)
2. [WebSocket Requirements](#websocket-requirements)
3. [Session Affinity Configuration](#session-affinity-configuration)
4. [Timeout Alignment](#timeout-alignment)
5. [Health Check Configuration](#health-check-configuration)
6. [Platform-Specific Configurations](#platform-specific-configurations)
7. [Graceful Shutdown Sequencing](#graceful-shutdown-sequencing)
8. [Validation & Testing](#validation--testing)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### Mission

Configure the load balancer for WebSocket upgrades, sticky sessions, health checks, and timeouts that align with heartbeat behavior, minimizing renegotiations and oscillations.

### Key Metrics

- **Heartbeat Interval**: 25,000ms (25 seconds)
- **Grace Window**: 25,000ms (25 seconds)
- **Effective Ping Timeout**: 50,000ms (heartbeat + grace)
- **Presence TTL**: 51,000ms minimum
- **Replay Cache TTL**: 300,000ms (5 minutes)

### Success Criteria

- ✅ Minimal connection renegotiations
- ✅ Stable long-lived connections (hours to days)
- ✅ Graceful behavior during scale-in and zone failures
- ✅ Zero dropped connections during normal operations
- ✅ <1% connection churn during zonal impairment

---

## WebSocket Requirements

### Protocol Upgrade

WebSocket connections require HTTP/1.1 upgrade handling:

```nginx
# Essential headers for WebSocket upgrade
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Connection Characteristics

```
┌─────────────┐     WebSocket      ┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │ ───────────────▶   │     LB      │ ───────────────▶   │   Backend   │
└─────────────┘                     └─────────────┘                     └─────────────┘
      │                                   │                                   │
      │◄──────── Heartbeat Ping ──────────┼───────────────────────────────────│
      │                25s                 │                                   │
      │                                   │◄─── Presence Heartbeat (25s) ─────│
      │                                   │                                   │
      │◄────── Pong (grace: 25s) ─────────┼───────────────────────────────────│
```

**Critical Requirements**:

1. **Full Duplex**: Both client→server and server→client traffic
2. **Long-Lived**: Connections may persist for hours
3. **Sticky**: Client must remain bound to same backend instance
4. **Low Latency**: Real-time message delivery (<100ms p95)

---

## Session Affinity Configuration

### Why Session Affinity?

WebSocket state (authentication, presence, message replay cursor) is maintained in-memory per backend instance. **Loss of affinity breaks resume protocol and forces full reconnection.**

### Recommended Strategy: Cookie-Based Affinity

**Advantages**:

- Survives client IP changes (mobile networks, VPN switches)
- Works across multiple client tabs/windows
- Explicit control over expiry
- Survives backend pod restarts with graceful drain

**Configuration Matrix**:

| LB Platform        | Cookie Name       | TTL          | Fallback    |
| ------------------ | ----------------- | ------------ | ----------- |
| Nginx              | `sticky_route`    | Session      | IP hash     |
| AWS ALB            | `AWSALB`          | 1 day        | Round-robin |
| GCP LB             | `GCLB`            | 8 hours      | Client IP   |
| Kubernetes Ingress | `affinity-cookie` | Configurable | IP hash     |

### Alternative: IP Hash

**Use When**:

- Corporate networks with stable IPs
- IoT devices with fixed addresses
- Datacenter-to-datacenter communication

**Limitations**:

- Mobile clients changing networks → reconnect required
- NAT/Proxy IP changes → affinity lost
- Less control over distribution

---

## Timeout Alignment

### LB Idle Timeout Calculation

The load balancer must **not** disconnect idle but healthy connections. Align timeouts with heartbeat behavior:

```
LB Idle Timeout = Heartbeat Interval + Grace Window + Safety Margin

Minimum: 25s + 25s + 10s = 60 seconds
Recommended: 25s + 25s + 30s = 80 seconds (33% safety margin)
Conservative: 25s + 25s + 60s = 110 seconds (2x heartbeat)
```

### Timeout Hierarchy

```
┌────────────────────────────────────────────────────────────────┐
│  Load Balancer Idle Timeout: 80s (recommended)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Socket.IO Ping Timeout: 50s (heartbeat + grace)         │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Heartbeat Interval: 25s                           │  │  │
│  │  │  Grace Window: 25s                                 │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Why This Matters**:

- **Too Short**: LB drops healthy connections before heartbeat timeout → false disconnects
- **Too Long**: Delays detection of genuinely dead connections → resource leak
- **Misaligned**: Oscillating disconnects/reconnects → churn and perceived instability

### Environment Variable Configuration

```bash
# Backend configuration (.env)
SOCKET_HEARTBEAT_INTERVAL_MS=25000  # 25 seconds
SOCKET_HEARTBEAT_GRACE_MS=25000     # 25 seconds (pingTimeout = 50s)
SOCKET_PRESENCE_TTL_MS=51000        # Must be > interval + grace
```

---

## Health Check Configuration

### Readiness vs. Liveness

| Check Type    | Purpose                  | Endpoint           | Success Criteria                | Failure Action      |
| ------------- | ------------------------ | ------------------ | ------------------------------- | ------------------- |
| **Readiness** | Can accept traffic?      | `/health`          | HTTP 200 + `status: "ok"`       | Remove from LB pool |
| **Liveness**  | Is process alive?        | `/health/database` | HTTP 200 + `overall: "healthy"` | Restart pod         |
| **Startup**   | Initialization complete? | `/health`          | HTTP 200                        | Wait before traffic |

### Health Check Endpoints

#### 1. Basic Readiness: `/health`

```bash
curl http://localhost:3001/health
```

**Success Response** (HTTP 200):

```json
{
  "status": "ok",
  "timestamp": "2025-10-22T10:30:00.000Z",
  "environment": "production",
  "uptime": 86400.5,
  "memory": {
    "rss": 256000000,
    "heapUsed": 128000000,
    "heapTotal": 192000000
  },
  "version": "v20.10.0",
  "database": {
    "overall": "healthy",
    "database": "connected",
    "operationsSuccessful": true
  }
}
```

**Failure Response** (HTTP 503):

```json
{
  "status": "error",
  "timestamp": "2025-10-22T10:30:00.000Z",
  "database": {
    "overall": "unhealthy",
    "database": "disconnected",
    "operationsSuccessful": false,
    "errors": ["Connection timeout"]
  }
}
```

#### 2. Database Health: `/health/database`

```bash
curl http://localhost:3001/health/database
```

**Response**:

```json
{
  "timestamp": "2025-10-22T10:30:00.000Z",
  "connection": {
    "status": "connected",
    "latency": "5ms"
  },
  "operations": {
    "success": true,
    "operations": ["read", "write"],
    "errors": []
  },
  "summary": {
    "overall": "healthy",
    "database": "connected",
    "operationsSuccessful": true,
    "totalOperations": 2,
    "errors": 0
  }
}
```

### Health Check Timing Configuration

```yaml
# Kubernetes example
livenessProbe:
  httpGet:
    path: /health/database
    port: 3001
  initialDelaySeconds: 30 # Wait for app startup
  periodSeconds: 10 # Check every 10s
  timeoutSeconds: 5 # 5s timeout per check
  successThreshold: 1 # 1 success = healthy
  failureThreshold: 3 # 3 failures = restart (30s grace)

readinessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 10 # Quick readiness check
  periodSeconds: 5 # Check every 5s
  timeoutSeconds: 3 # 3s timeout
  successThreshold: 1 # 1 success = ready
  failureThreshold: 2 # 2 failures = unready (10s)

startupProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 0
  periodSeconds: 5
  timeoutSeconds: 3
  successThreshold: 1
  failureThreshold: 12 # 60s total startup time
```

**Key Principles**:

- **Liveness checks slower**: Avoid false-positive restarts (10s interval)
- **Readiness checks faster**: Quick removal from pool (5s interval)
- **Startup checks forgiving**: Allow slow initialization (60s total)
- **Timeout < Interval**: Prevent overlapping checks

### preStop Hook Integration

Health checks must respect graceful shutdown:

```yaml
lifecycle:
  preStop:
    exec:
      command:
        - /bin/sh
        - -c
        - |
          # Mark unhealthy for readiness checks
          touch /tmp/shutdown-initiated

          # Wait for LB to detect unhealthy (2 × readiness period)
          sleep 10

          # Initiate graceful shutdown
          kill -SIGTERM 1

          # Wait for connections to drain (max)
          sleep 30
```

**Sequence**:

1. `preStop` hook triggered
2. Mark pod unhealthy → readiness probe fails
3. LB removes pod from pool (10s)
4. New connections blocked
5. Existing connections drain (30s)
6. Process exits gracefully

---

## Platform-Specific Configurations

### 1. Nginx (Ingress Controller)

```nginx
# nginx.conf for WebSocket proxying

upstream websocket_backend {
    # Sticky sessions via IP hash (alternative to cookie)
    ip_hash;

    # Backend servers
    server backend-1.local:3001 max_fails=3 fail_timeout=30s;
    server backend-2.local:3001 max_fails=3 fail_timeout=30s;
    server backend-3.local:3001 max_fails=3 fail_timeout=30s;

    # Health checks (nginx plus / open-source module)
    # check interval=5s rise=2 fall=3 timeout=3s type=http;
    # check_http_send "GET /health HTTP/1.0\r\n\r\n";
    # check_http_expect_alive http_2xx http_3xx;

    # Connection pool
    keepalive 64;
}

server {
    listen 80;
    server_name chat.example.com;

    # Client timeouts
    client_body_timeout 60s;
    client_header_timeout 60s;

    # Proxy timeouts - CRITICAL for WebSocket
    proxy_connect_timeout 10s;    # Backend connect timeout
    proxy_send_timeout 300s;      # Send to backend timeout
    proxy_read_timeout 80s;       # *** ALIGNED WITH HEARTBEAT ***

    # WebSocket location
    location /socket.io/ {
        # WebSocket upgrade headers
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Preserve client information
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Buffering disabled for real-time
        proxy_buffering off;
        proxy_cache off;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_read_timeout 80s;      # *** 80s = heartbeat(25s) + grace(25s) + margin(30s) ***

        proxy_pass http://websocket_backend;
    }

    # Health check endpoint (no sticky session needed)
    location /health {
        proxy_pass http://websocket_backend;
        proxy_set_header Host $host;
        proxy_connect_timeout 3s;
        proxy_send_timeout 3s;
        proxy_read_timeout 3s;
    }

    # REST API endpoints
    location /api/ {
        proxy_pass http://websocket_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Standard HTTP timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Key Settings Explained**:

- `proxy_read_timeout 80s`: Must exceed heartbeat + grace (50s) with margin
- `ip_hash`: Simple sticky session based on client IP
- `proxy_buffering off`: Real-time message delivery
- `keepalive 64`: Connection pooling to backends

### 2. Kubernetes Ingress (NGINX Ingress Controller)

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: chat-backend-ingress
  namespace: production
  annotations:
    # WebSocket support
    nginx.ingress.kubernetes.io/websocket-services: "chat-backend"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "80"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "10"

    # Session affinity (cookie-based)
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "persistent"
    nginx.ingress.kubernetes.io/session-cookie-name: "chat_session"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "86400" # 24 hours
    nginx.ingress.kubernetes.io/session-cookie-change-on-failure: "true"

    # Buffering
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-request-buffering: "off"

    # Client limits
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"

    # CORS (if needed)
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://app.example.com"
    nginx.ingress.kubernetes.io/cors-allow-credentials: "true"

spec:
  ingressClassName: nginx
  rules:
    - host: chat.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: chat-backend
                port:
                  number: 3001
  tls:
    - hosts:
        - chat.example.com
      secretName: chat-tls-secret
```

### 3. AWS Application Load Balancer (ALB)

```yaml
# alb-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: chat-backend-alb
  namespace: production
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip

    # WebSocket support (HTTP/2 disabled)
    alb.ingress.kubernetes.io/backend-protocol: HTTP
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'

    # Session stickiness
    alb.ingress.kubernetes.io/target-group-attributes: |
      stickiness.enabled=true,
      stickiness.type=lb_cookie,
      stickiness.lb_cookie.duration_seconds=86400,
      deregistration_delay.timeout_seconds=30

    # Health checks
    alb.ingress.kubernetes.io/healthcheck-path: /health
    alb.ingress.kubernetes.io/healthcheck-interval-seconds: "15"
    alb.ingress.kubernetes.io/healthcheck-timeout-seconds: "5"
    alb.ingress.kubernetes.io/healthy-threshold-count: "2"
    alb.ingress.kubernetes.io/unhealthy-threshold-count: "3"
    alb.ingress.kubernetes.io/success-codes: "200"

    # Timeouts - *** CRITICAL ***
    alb.ingress.kubernetes.io/load-balancer-attributes: |
      idle_timeout.timeout_seconds=80

    # Tags
    alb.ingress.kubernetes.io/tags: |
      Environment=production,
      Service=chat-backend,
      ManagedBy=kubernetes
spec:
  rules:
    - host: chat.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: chat-backend
                port:
                  number: 3001
```

**ALB-Specific Notes**:

- `idle_timeout.timeout_seconds=80`: Must exceed ping timeout (50s)
- `deregistration_delay.timeout_seconds=30`: Connection drain period
- `stickiness.lb_cookie.duration_seconds=86400`: 24-hour session persistence
- ALB automatically handles WebSocket upgrade when using HTTP backend protocol

### 4. GCP Load Balancer

```yaml
# gcp-backend-config.yaml
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: chat-backend-config
  namespace: production
spec:
  timeoutSec: 80 # *** CRITICAL: 80s timeout ***
  connectionDraining:
    drainingTimeoutSec: 30 # Graceful shutdown window
  sessionAffinity:
    affinityType: "CLIENT_IP" # Or "GENERATED_COOKIE"
    affinityCookieTtlSec: 86400 # 24 hours
  healthCheck:
    checkIntervalSec: 10
    timeoutSec: 5
    healthyThreshold: 2
    unhealthyThreshold: 3
    type: HTTP
    requestPath: /health
    port: 3001
---
# Service with BackendConfig
apiVersion: v1
kind: Service
metadata:
  name: chat-backend
  namespace: production
  annotations:
    cloud.google.com/backend-config: '{"default": "chat-backend-config"}'
    cloud.google.com/neg: '{"ingress": true}'
spec:
  type: ClusterIP
  selector:
    app: chat-backend
  ports:
    - port: 3001
      targetPort: 3001
      protocol: TCP
      name: http
```

---

## Graceful Shutdown Sequencing

### Sequence Diagram

```
Time     Load Balancer       Pod                  Backend Process        Active Connections
────────────────────────────────────────────────────────────────────────────────────────
  0s     │                   │ preStop hook         │                      │ (100 active)
         │                   │ triggered            │                      │
         │                   │                      │                      │
  +2s    │                   │ Mark unhealthy ──────▶ /tmp/shutdown       │
         │                   │                      │                      │
  +5s    │ Health check ────▶│ 503 Service          │                      │
         │ fails             │ Unavailable          │                      │
         │                   │                      │                      │
  +10s   │ Remove from ──────┤                      │                      │
         │ pool (no new      │                      │                      │
         │ connections)      │                      │                      │
         │                   │                      │                      │
  +12s   │                   │ Send SIGTERM ────────▶ Graceful shutdown   │
         │                   │                      │ initiated            │
         │                   │                      │                      │
         │                   │                      │ Close Socket.IO ─────▶ (90 active)
         │                   │                      │ server (no new       │ Existing drain
         │                   │                      │ connections)         │
         │                   │                      │                      │
  +15s   │                   │                      │ Notify clients ──────▶ (70 active)
         │                   │                      │ "server_shutdown"    │ Graceful close
         │                   │                      │                      │
  +25s   │                   │                      │ Wait for cleanup ────▶ (30 active)
         │                   │                      │                      │ Slow draining
         │                   │                      │                      │
  +40s   │                   │                      │ Force close ─────────▶ (0 active)
         │                   │                      │ remaining            │ All closed
         │                   │                      │                      │
  +42s   │                   │                      │ Exit(0) ─────────────┤
         │                   │                      │                      │
  +45s   │                   │ Pod terminated       │                      │
         │                   X                      X                      X
```

### Implementation: preStop Hook

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chat-backend
  namespace: production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0 # Zero-downtime deployments
  selector:
    matchLabels:
      app: chat-backend
  template:
    metadata:
      labels:
        app: chat-backend
        version: v1.0.0
    spec:
      terminationGracePeriodSeconds: 45 # Must exceed drain + shutdown time

      containers:
        - name: chat-backend
          image: chat-backend:latest
          ports:
            - containerPort: 3001
              name: http
              protocol: TCP

          # Lifecycle hooks
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    #!/bin/sh
                    set -e

                    echo "$(date '+%Y-%m-%d %H:%M:%S') - PreStop hook initiated"

                    # 1. Mark pod unhealthy for readiness checks
                    touch /tmp/shutdown-initiated
                    echo "$(date '+%Y-%m-%d %H:%M:%S') - Marked unhealthy"

                    # 2. Wait for LB to detect unhealthy and stop routing
                    # (2 × readiness check interval = 2 × 5s = 10s)
                    sleep 10
                    echo "$(date '+%Y-%m-%d %H:%M:%S') - LB deregistration complete"

                    # 3. Send SIGTERM to Node.js process for graceful shutdown
                    # (PID 1 in container)
                    kill -SIGTERM 1
                    echo "$(date '+%Y-%m-%d %H:%M:%S') - SIGTERM sent to process"

                    # 4. Wait for active connections to drain
                    # (30s drain window)
                    sleep 30
                    echo "$(date '+%Y-%m-%d %H:%M:%S') - Drain period complete"

                    # Process should exit gracefully by now
                    # If not, Kubernetes will send SIGKILL after terminationGracePeriodSeconds

          # Readiness probe modified to check shutdown flag
          readinessProbe:
            exec:
              command:
                - /bin/sh
                - -c
                - |
                  # Fail if shutdown initiated
                  if [ -f /tmp/shutdown-initiated ]; then
                    exit 1
                  fi
                  # Otherwise check health endpoint
                  curl -f http://localhost:3001/health || exit 1
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            successThreshold: 1
            failureThreshold: 2

          livenessProbe:
            httpGet:
              path: /health/database
              port: 3001
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

          startupProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 12

          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3001"
            - name: SOCKET_HEARTBEAT_INTERVAL_MS
              value: "25000"
            - name: SOCKET_HEARTBEAT_GRACE_MS
              value: "25000"

          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### Application-Level Graceful Shutdown

Update `src/main.ts` to handle SIGTERM:

```typescript
// src/main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule);

  // Configure app...

  await app.listen(3001);
  logger.log("Application is listening on port 3001");

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    logger.log(`${signal} received, initiating graceful shutdown...`);

    try {
      // 1. Stop accepting new connections
      await app.close();
      logger.log("HTTP server closed, no longer accepting connections");

      // 2. Socket.IO server will emit 'server_shutdown' to clients
      // (handled by socket gateway's onModuleDestroy)

      // 3. Wait briefly for messages in flight
      await new Promise((resolve) => setTimeout(resolve, 2000));
      logger.log("Grace period complete");

      // 4. Exit cleanly
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

bootstrap();
```

### Socket Gateway Cleanup

```typescript
// src/socket/socket.gateway.ts (or wherever Socket.IO is initialized)
import { OnModuleDestroy } from "@nestjs/common";
import { Server } from "socket.io";

export class SocketGateway implements OnModuleDestroy {
  private io: Server;

  async onModuleDestroy() {
    if (!this.io) return;

    console.log("Socket.IO graceful shutdown initiated");

    // 1. Stop accepting new connections
    this.io.close();

    // 2. Notify all connected clients
    this.io.emit("server_shutdown", {
      reason: "Maintenance or deployment",
      reconnect: true,
      delayMs: 5000,
    });

    // 3. Wait for messages to flush
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Disconnect all sockets
    const sockets = await this.io.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }

    console.log(
      `Socket.IO shutdown complete, disconnected ${sockets.length} clients`,
    );
  }
}
```

---

## Validation & Testing

### 1. WebSocket Connection Test

```bash
# Using websocat (https://github.com/vi/websocat)
websocat -v wss://chat.example.com/socket.io/?EIO=4&transport=websocket

# Or using wscat
wscat -c "wss://chat.example.com/socket.io/?EIO=4&transport=websocket"

# Expected: Successful upgrade, periodic ping/pong frames
```

### 2. Session Affinity Test

```bash
#!/bin/bash
# Test script: test-affinity.sh

URL="https://chat.example.com/socket.io/"
COOKIES_FILE="/tmp/cookies.txt"

echo "=== Testing Session Affinity ==="

# First request - establish session
echo "Request 1:"
curl -v -c $COOKIES_FILE -X GET "$URL" 2>&1 | grep -E "(Set-Cookie|Server|X-Backend-Server)"

# Second request - should hit same backend
echo -e "\nRequest 2 (with cookies):"
curl -v -b $COOKIES_FILE -X GET "$URL" 2>&1 | grep -E "(Cookie|Server|X-Backend-Server)"

# Third request - should hit same backend
echo -e "\nRequest 3 (with cookies):"
curl -v -b $COOKIES_FILE -X GET "$URL" 2>&1 | grep -E "(Cookie|Server|X-Backend-Server)"

rm -f $COOKIES_FILE
```

**Expected Output**:

```
Request 1:
< Set-Cookie: AWSALB=abc123; Path=/; Expires=...
< X-Backend-Server: backend-2

Request 2 (with cookies):
> Cookie: AWSALB=abc123
< X-Backend-Server: backend-2

Request 3 (with cookies):
> Cookie: AWSALB=abc123
< X-Backend-Server: backend-2
```

### 3. Idle Timeout Test

```javascript
// test-idle-timeout.js
const io = require("socket.io-client");

const socket = io("wss://chat.example.com", {
  transports: ["websocket"],
  auth: { token: "YOUR_TOKEN" },
});

let lastPing = Date.now();

socket.on("ping", () => {
  const now = Date.now();
  const elapsed = now - lastPing;
  console.log(`Ping received after ${elapsed}ms`);
  lastPing = now;
});

socket.on("disconnect", (reason) => {
  console.error(`Disconnected: ${reason}`);
  console.log(`Connection lasted: ${Date.now() - lastPing}ms since last ping`);
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);
  lastPing = Date.now();
});

// Keep process alive
setTimeout(() => {
  console.log("Test complete, connection stable");
  socket.close();
}, 300000); // 5 minutes
```

**Run Test**:

```bash
node test-idle-timeout.js
```

**Expected Output**:

```
Connected: xYz789
Ping received after 25000ms
Ping received after 25000ms
Ping received after 25000ms
...
Test complete, connection stable
```

**❌ Failure Mode (LB timeout too short)**:

```
Connected: xYz789
Ping received after 25000ms
Ping received after 25000ms
Disconnected: transport close
Connection lasted: 25123ms since last ping  ← Disconnected before next ping!
```

### 4. Graceful Shutdown Test

```bash
# Terminal 1: Monitor active connections
watch -n 1 'kubectl get pods -l app=chat-backend -o wide'

# Terminal 2: Connect multiple clients
for i in {1..50}; do
  node test-client.js &
done

# Terminal 3: Trigger rolling update
kubectl rollout restart deployment/chat-backend -n production

# Expected behavior:
# - Existing connections remain active until client disconnect or drain timeout
# - New connections route to new pods
# - Zero "transport close" disconnect reasons during rollout
```

### 5. Cross-Zone Failover Test

```bash
#!/bin/bash
# Simulate zone failure

NAMESPACE="production"
DEPLOYMENT="chat-backend"

echo "=== Cross-Zone Failover Test ==="

# Get current pod distribution
echo "Initial pod distribution:"
kubectl get pods -n $NAMESPACE -l app=$DEPLOYMENT -o wide | awk '{print $1, $7}'

# Cordon nodes in zone-a (simulate zone failure)
echo -e "\n=== Simulating zone-a failure ==="
kubectl get nodes -l topology.kubernetes.io/zone=zone-a -o name | \
  xargs -I {} kubectl cordon {}

# Monitor connection metrics
echo -e "\n=== Monitoring connection churn ==="
for i in {1..30}; do
  DISCONNECTS=$(kubectl logs -n $NAMESPACE -l app=$DEPLOYMENT --tail=50 | grep -c "disconnect")
  RECONNECTS=$(kubectl logs -n $NAMESPACE -l app=$DEPLOYMENT --tail=50 | grep -c "connection")
  echo "$(date +%T) - Disconnects: $DISCONNECTS, Reconnects: $RECONNECTS"
  sleep 2
done

# Uncordon nodes
kubectl get nodes -l topology.kubernetes.io/zone=zone-a -o name | \
  xargs -I {} kubectl uncordon {}

echo -e "\n=== Test complete ==="
```

**Success Criteria**:

- **Connection Churn**: <1% of active connections drop
- **Reconnect Time**: <5 seconds for clients to re-establish
- **No Data Loss**: Messages sent during failover are replayed via resume protocol

---

## Troubleshooting

### Issue 1: Frequent Disconnections (~50s intervals)

**Symptoms**:

- Clients disconnect every ~50 seconds
- Logs show `disconnect: transport close`
- Reconnections happen immediately after

**Root Cause**: LB idle timeout < heartbeat + grace

**Diagnosis**:

```bash
# Check backend logs for disconnect timing
kubectl logs -n production -l app=chat-backend --tail=100 | grep disconnect

# Expected pattern if LB timeout is too short:
# 2025-10-22T10:00:00Z - socket.disconnect - transport close
# 2025-10-22T10:00:50Z - socket.disconnect - transport close
# 2025-10-22T10:01:40Z - socket.disconnect - transport close
# ↑ ~50s intervals = LB timeout
```

**Solution**:

```nginx
# Nginx
proxy_read_timeout 80s;  # Was 60s, increase to 80s

# AWS ALB
idle_timeout.timeout_seconds=80  # Was 60, increase to 80

# GCP LB
timeoutSec: 80  # Was 60, increase to 80
```

### Issue 2: Connections Not Sticky

**Symptoms**:

- Clients receive `resume failed: cursor not found`
- Multiple backend pods report connections from same user
- Message replay fails

**Diagnosis**:

```bash
# Check if requests hit different backends
for i in {1..10}; do
  curl -v https://chat.example.com/health 2>&1 | grep X-Backend-Server
done

# If output shows different servers:
< X-Backend-Server: backend-1
< X-Backend-Server: backend-3
< X-Backend-Server: backend-1
< X-Backend-Server: backend-2
# → No session affinity!
```

**Solution (Nginx)**:

```nginx
upstream websocket_backend {
    ip_hash;  # Enable IP-based stickiness
    # ... servers ...
}

# Or cookie-based (requires nginx plus or module):
sticky cookie chat_session expires=1d domain=.example.com path=/;
```

**Solution (Kubernetes Ingress)**:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: "cookie"
  nginx.ingress.kubernetes.io/session-cookie-name: "chat_session"
```

### Issue 3: Health Checks Fail During High Load

**Symptoms**:

- Pods marked unhealthy during load spikes
- Healthy pods removed from LB pool
- Service degradation cascades

**Root Cause**: Health check timeout too aggressive

**Solution**:

```yaml
readinessProbe:
  timeoutSeconds: 5 # Increase from 3s
  failureThreshold: 3 # Increase from 2
  periodSeconds: 10 # Increase from 5s
```

**Alternative**: Dedicated health check thread/endpoint that doesn't compete for resources.

### Issue 4: Connections Dropped During Deployments

**Symptoms**:

- All clients disconnect during `kubectl rollout`
- Users report "server unavailable" errors

**Diagnosis**:

```bash
# Check termination grace period
kubectl get deployment chat-backend -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}'

# Check preStop hook existence
kubectl get deployment chat-backend -o jsonpath='{.spec.template.spec.containers[0].lifecycle.preStop}'
```

**Solution**:

1. Ensure `terminationGracePeriodSeconds` ≥ 45s
2. Implement preStop hook (see [Graceful Shutdown](#graceful-shutdown-sequencing))
3. Use rolling update strategy with `maxUnavailable: 0`

### Issue 5: High Connection Churn During Zone Failure

**Symptoms**:

- Massive disconnect/reconnect storm when availability zone fails
- Prolonged service degradation

**Root Cause**: Clients retry too aggressively; LB doesn't fail over smoothly

**Solution**:

**Client-Side** (exponential backoff):

```javascript
const socket = io("wss://chat.example.com", {
  reconnection: true,
  reconnectionDelay: 1000, // Start at 1s
  reconnectionDelayMax: 10000, // Max 10s
  reconnectionAttempts: Infinity,
  randomizationFactor: 0.5, // Add jitter
});
```

**Server-Side** (health check tuning):

```yaml
# Faster detection of unhealthy pods
readinessProbe:
  periodSeconds: 3 # Check every 3s (was 5s)
  failureThreshold: 2 # 2 failures = unready (6s total)
```

---

## Monitoring & Alerting

### Key Metrics

| Metric                                     | Threshold          | Severity | Action                               |
| ------------------------------------------ | ------------------ | -------- | ------------------------------------ |
| **Connection Churn Rate**                  | >5% per minute     | Warning  | Investigate LB/app logs              |
| **Connection Churn Rate**                  | >10% per minute    | Critical | Check LB timeouts, zone health       |
| **Disconnect Reason: `transport close`**   | >1% of disconnects | Warning  | Review LB idle timeout               |
| **Disconnect Reason: `heartbeat_timeout`** | >5% of disconnects | Critical | Backend overload or network issues   |
| **LB Health Check Failures**               | >10%               | Critical | Check backend capacity, DB health    |
| **Readiness Probe Failures**               | >5%                | Warning  | Increase resource limits             |
| **Avg. Reconnect Time**                    | >5s                | Warning  | Optimize reconnection logic          |
| **Failed Resume Attempts**                 | >2%                | Warning  | Check session affinity, replay cache |

### Prometheus Queries

```promql
# Connection churn rate (per minute)
rate(ws_connections_total[1m]) * 60

# Disconnect reasons breakdown
rate(socket_disconnect_total[5m]) by (reason)

# Health check failure rate
rate(http_requests_total{endpoint="/health", status!="200"}[5m]) /
rate(http_requests_total{endpoint="/health"}[5m])

# Average connection duration
histogram_quantile(0.95,
  rate(connection_duration_seconds_bucket[5m])
)

# Failed resume attempts
rate(message_replay_total{source="cache", status="failed"}[5m])
```

### Grafana Dashboard Panels

```json
{
  "title": "WebSocket Connection Stability",
  "panels": [
    {
      "title": "Active Connections",
      "targets": ["ws_connections"],
      "yAxis": { "label": "Connections" }
    },
    {
      "title": "Connection Churn Rate",
      "targets": ["rate(ws_connections_total[1m]) * 60"],
      "yAxis": { "label": "Conn/min" }
    },
    {
      "title": "Disconnect Reasons",
      "targets": ["rate(socket_disconnect_total[5m]) by (reason)"],
      "type": "graph",
      "stacked": true
    },
    {
      "title": "LB Health Check Success Rate",
      "targets": [
        "sum(rate(http_requests_total{endpoint='/health', status='200'}[5m])) / sum(rate(http_requests_total{endpoint='/health'}[5m])) * 100"
      ],
      "yAxis": { "label": "%", "min": 0, "max": 100 }
    }
  ]
}
```

---

## Summary Checklist

### Pre-Deployment

- [ ] LB idle timeout set to ≥80s (heartbeat + grace + margin)
- [ ] WebSocket upgrade headers configured (`Upgrade`, `Connection`)
- [ ] Session affinity enabled (cookie or IP hash)
- [ ] Health check endpoints verified (`/health`, `/health/database`)
- [ ] Health check timing validated (readiness <10s, liveness >30s)
- [ ] preStop hook implemented with 10s LB drain + 30s connection drain
- [ ] `terminationGracePeriodSeconds` set to ≥45s
- [ ] Rolling update strategy with `maxUnavailable: 0`

### Post-Deployment

- [ ] WebSocket connections stable for >5 minutes (no disconnects)
- [ ] Session affinity verified (same backend across requests)
- [ ] Health checks passing consistently (>99% success)
- [ ] Graceful shutdown tested (zero dropped connections during rollout)
- [ ] Connection churn <1% during normal operations
- [ ] Cross-zone failover tested (<5% connection churn)
- [ ] Monitoring dashboards created
- [ ] Alerts configured for churn rate, disconnect reasons, health failures

---

## References

- [Socket.IO Documentation - Load Balancing](https://socket.io/docs/v4/using-multiple-nodes/)
- [Nginx WebSocket Proxying](https://nginx.org/en/docs/http/websocket.html)
- [Kubernetes Graceful Shutdown](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [AWS ALB Target Groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [GCP Load Balancer Backend Services](https://cloud.google.com/load-balancing/docs/backend-service)

**Last Reviewed**: 2025-10-22  
**Maintained By**: Infrastructure Engineering Team  
**Next Review**: 2025-11-22 (monthly)
