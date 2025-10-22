import { EventEmitter } from "events";

export type PresenceStatus = "online" | "offline";

export interface PresenceEventPayload {
  readonly userId: string;
  readonly status: PresenceStatus;
  readonly instanceId: string;
  readonly socketId?: string;
  readonly timestamp: string;
}

const emitter = new EventEmitter();

type Listener = (payload: PresenceEventPayload) => void;

type PresenceEventName = "presence.online" | "presence.offline";

export const presenceEvents = {
  on(event: PresenceEventName, listener: Listener): void {
    emitter.on(event, listener);
  },
  once(event: PresenceEventName, listener: Listener): void {
    emitter.once(event, listener);
  },
  off(event: PresenceEventName, listener: Listener): void {
    emitter.off(event, listener);
  },
  emit(event: PresenceEventName, payload: PresenceEventPayload): void {
    emitter.emit(event, payload);
  },
};
