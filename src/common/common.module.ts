import { Module, Global } from "@nestjs/common";
import { PrismaModule } from "../infra/prisma/prisma.module";
import { DatabaseHealthService } from "./services/database-health.service";
import { MobileOptimizationService } from "./services/mobile-optimization.service";
import { CacheService } from "./services/cache.service";
import { DbConnectionMonitor } from "../infra/services/db-connection-monitor.service";
import { PrismaReadReplicaService } from "../infra/services/prisma-read-replica.service";
import { ReplicaLagMonitor } from "../infra/services/replica-lag-monitor.service";
import { ReadReplicaCircuitBreaker } from "../infra/services/read-replica-circuit-breaker.service";
import { DatabaseAccessLayer } from "../infra/services/database-access-layer.service";
import {
  UnreadCountBatcher,
  MessageBatcher,
} from "./services/batch-query.service";
import { HealthController } from "./controllers/health.controller";

// Phase 2 Database Health Monitoring Services
import { AutovacuumConfigService } from "../infra/services/autovacuum-config.service";
import { VacuumHealthMonitor } from "../infra/services/vacuum-health-monitor.service";
import { QueryPerformanceMonitor } from "../infra/services/query-performance-monitor.service";
import { PgBouncerMonitor } from "../infra/services/pgbouncer-monitor.service";

@Global() // Make core services available globally
@Module({
  imports: [PrismaModule],
  providers: [
    // Health and monitoring
    DatabaseHealthService,
    MobileOptimizationService,
    DbConnectionMonitor,

    // Phase 2: Database health monitoring (initialized in order)
    // Order matters: Autovacuum → Monitors → DAL
    AutovacuumConfigService, // 1. Configure autovacuum settings
    VacuumHealthMonitor, // 2. Monitor vacuum health (depends on PrismaService)
    QueryPerformanceMonitor, // 3. Monitor query performance (Prisma middleware)
    PgBouncerMonitor, // 4. Monitor PgBouncer pools

    // Caching
    CacheService,

    // Read replica infrastructure
    PrismaReadReplicaService,
    ReplicaLagMonitor,
    ReadReplicaCircuitBreaker,
    DatabaseAccessLayer,

    // Query optimization
    UnreadCountBatcher,
    MessageBatcher,
  ],
  controllers: [HealthController],
  exports: [
    // Health and monitoring
    DatabaseHealthService,
    MobileOptimizationService,
    DbConnectionMonitor,

    // Phase 2: Database health monitoring
    AutovacuumConfigService,
    VacuumHealthMonitor,
    QueryPerformanceMonitor,
    PgBouncerMonitor,

    // Caching
    CacheService,

    // Read replica infrastructure
    PrismaReadReplicaService,
    ReplicaLagMonitor,
    ReadReplicaCircuitBreaker,
    DatabaseAccessLayer,

    // Query optimization
    UnreadCountBatcher,
    MessageBatcher,
  ],
})
export class CommonModule {}
