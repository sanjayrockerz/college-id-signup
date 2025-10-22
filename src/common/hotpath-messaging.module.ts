import { Module } from "@nestjs/common";
import { PrismaService } from "../infra/prisma/prisma.service";
import { RedisStreamsService } from "../infra/queue/redis-streams.service";
import { PresenceRegistryService } from "../infra/services/presence-registry.service";
import { SocketEmitterService } from "../infra/services/socket-emitter.service";
import { PushQueueService } from "../infra/services/push-queue.service";
import { PushTokenStore } from "../infra/services/push-token.store";
import { PushDeliveryService } from "../infra/services/push-delivery.service";
import { MessagingGateway } from "../infra/gateways/messaging.gateway";

// Producer
import { MessageProducerService } from "./services/message-producer.service";
import { MessageProducerController } from "./controllers/message-producer.controller";

// Delivery Workers
import { MessagePersistenceWorker } from "../infra/services/message-persistence.worker";
import { OnlineFanoutWorker } from "../infra/services/online-fanout.worker";
import { PushNotificationWorker } from "../infra/services/push-notification.worker";
import { DeliveryPipelineConsumer } from "../infra/services/delivery-pipeline.consumer";

/**
 * Hot-Path Messaging Module
 *
 * ARCHITECTURE:
 * - Producer: Fast validate-and-queue with pending ACK
 * - Consumers: Robust delivery pipeline with idempotency
 *
 * COMPONENTS:
 * 1. Producer:
 *    - MessageProducerService (validation, enqueue, ACK)
 *    - MessageProducerController (HTTP endpoint)
 *
 * 2. Delivery Pipeline:
 *    - MessagePersistenceWorker (DB persistence with idempotency)
 *    - OnlineFanoutWorker (WebSocket delivery to online users)
 *    - PushNotificationWorker (FCM/APNS for offline users)
 *    - DeliveryPipelineConsumer (orchestrator)
 *
 * DEPENDENCIES:
 * - PrismaService (database)
 * - RedisStreamsService (queue)
 *
 * METRICS EXPOSED:
 * - Producer: enqueued, rejected, enqueue_duration
 * - Delivery: persist, fanout, push, pipeline_duration
 */

@Module({
  imports: [],
  controllers: [MessageProducerController],
  providers: [
    // Infrastructure
    PrismaService,
    RedisStreamsService,
    PresenceRegistryService,
    SocketEmitterService,
    PushQueueService,
    PushTokenStore,
    PushDeliveryService,
    MessagingGateway,

    // Producer
    MessageProducerService,

    // Delivery Workers
    MessagePersistenceWorker,
    OnlineFanoutWorker,
    PushNotificationWorker,

    // Consumer Orchestrator
    DeliveryPipelineConsumer,
  ],
  exports: [
    MessageProducerService,
    MessagePersistenceWorker,
    OnlineFanoutWorker,
    PushNotificationWorker,
    DeliveryPipelineConsumer,
    MessagingGateway,
  ],
})
export class HotPathMessagingModule {}
