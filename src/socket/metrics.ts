import { TelemetryMetrics } from "../observability/metrics-registry";

export type HandshakeOutcome = "accepted" | "rejected";

export type HandshakeRejectionReason =
  | "missing_token"
  | "malformed_token"
  | "invalid_signature"
  | "invalid_audience"
  | "invalid_issuer"
  | "expired"
  | "not_before"
  | "unauthorized"
  | "internal_error";

export type NormalizedDisconnectReason =
  | "auth_failure"
  | "heartbeat_timeout"
  | "transport_error"
  | "server_shutdown";

interface HandshakeRecord {
  readonly timestamp: string;
  readonly outcome: HandshakeOutcome;
  readonly reason?: HandshakeRejectionReason;
}

export class SocketMetrics {
  private static activeConnections = 0;
  private static handshakeTotals: Record<HandshakeOutcome, number> = {
    accepted: 0,
    rejected: 0,
  };
  private static handshakeRejections: Map<HandshakeRejectionReason, number> =
    new Map();
  private static disconnectReasons: Map<NormalizedDisconnectReason, number> =
    new Map();
  private static recentHandshakes: HandshakeRecord[] = [];
  private static readonly RECENT_HANDSHAKE_LIMIT = 200;

  static recordHandshake(
    outcome: HandshakeOutcome,
    reason?: HandshakeRejectionReason,
  ): void {
    this.handshakeTotals[outcome] = (this.handshakeTotals[outcome] ?? 0) + 1;

    if (outcome === "rejected" && reason) {
      const current = this.handshakeRejections.get(reason) ?? 0;
      this.handshakeRejections.set(reason, current + 1);
      TelemetryMetrics.incrementError("handshake");
    }

    TelemetryMetrics.recordHandshake(outcome);

    this.recentHandshakes.push({
      outcome,
      reason,
      timestamp: new Date().toISOString(),
    });

    if (this.recentHandshakes.length > this.RECENT_HANDSHAKE_LIMIT) {
      this.recentHandshakes.shift();
    }
  }

  static incrementConnections(): void {
    this.activeConnections += 1;
    TelemetryMetrics.setWsConnections(this.activeConnections);
  }

  static decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    TelemetryMetrics.setWsConnections(this.activeConnections);
  }

  static recordDisconnect(reason: NormalizedDisconnectReason): void {
    const current = this.disconnectReasons.get(reason) ?? 0;
    this.disconnectReasons.set(reason, current + 1);
    TelemetryMetrics.recordDisconnect(reason);
  }

  static snapshot() {
    return {
      ws_connections: this.activeConnections,
      socket_handshake_total: { ...this.handshakeTotals },
      socket_handshake_rejections: Object.fromEntries(this.handshakeRejections),
      socket_disconnect_total: Object.fromEntries(this.disconnectReasons),
      recent_handshakes: this.recentHandshakes.slice(-20),
    };
  }
}
