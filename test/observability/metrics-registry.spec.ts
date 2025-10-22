import { TelemetryMetrics } from "../../src/observability/metrics-registry";

const registry = TelemetryMetrics.registry();

function resetRegistry(): void {
  registry.resetMetrics();
  TelemetryMetrics.refreshEnvironment();
}

describe("TelemetryMetrics", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("tracks message throughput by type", async () => {
    TelemetryMetrics.incrementThroughput("send");
    TelemetryMetrics.incrementThroughput("send");
    TelemetryMetrics.incrementThroughput("history");

    const metric = registry.getSingleMetric("message_throughput_total");
    const snapshot = await metric?.get();
    const series = snapshot?.values ?? [];

    expect(series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 2,
          labels: expect.objectContaining({ type: "send" }),
        }),
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({ type: "history" }),
        }),
      ]),
    );
  });

  it("records latency histogram samples", async () => {
    TelemetryMetrics.observeDeliveryLatency("send", 45);
    TelemetryMetrics.observeDeliveryLatency("send", 250);

    const histogram = registry.getSingleMetric("delivery_latency_ms");
    const snapshot = await histogram?.get();
    const values = snapshot?.values ?? [];
    // prom-client's type definition omits metricName even though runtime values include it.
    const countSample = values.find((sample) =>
      (sample as any).metricName?.endsWith("_count"),
    );
    const sumSample = values.find((sample) =>
      (sample as any).metricName?.endsWith("_sum"),
    );

    expect(countSample?.value).toBe(2);
    expect(sumSample?.value).toBeCloseTo(295);
  });

  it("sets websocket connection gauge", async () => {
    TelemetryMetrics.setWsConnections(5);
    const gauge = registry.getSingleMetric("ws_connections");
    const initial = await gauge?.get();
    const data = initial?.values ?? [];
    expect(data[0]?.value).toBe(5);

    TelemetryMetrics.setWsConnections(0);
    const snapshot = await gauge?.get();
    const after = snapshot?.values ?? [];
    expect(after[0]?.value).toBe(0);
  });

  it("increments error counters", async () => {
    TelemetryMetrics.incrementError("send_message");
    TelemetryMetrics.incrementError("send_message");

    const metric = registry.getSingleMetric("error_total");
    const snapshot = await metric?.get();
    const values = snapshot?.values ?? [];
    const sendErrorSample = values.find(
      (sample) => sample.labels.event === "send_message",
    );
    expect(sendErrorSample?.value).toBe(2);
  });

  it("records handshake outcomes", async () => {
    TelemetryMetrics.recordHandshake("accepted");
    TelemetryMetrics.recordHandshake("rejected");
    TelemetryMetrics.recordHandshake("rejected");

    const metric = registry.getSingleMetric("handshake_total");
    const snapshot = await metric?.get();
    const values = snapshot?.values ?? [];

    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({ event: "handshake.accepted" }),
        }),
        expect.objectContaining({
          value: 2,
          labels: expect.objectContaining({ event: "handshake.rejected" }),
        }),
      ]),
    );
  });

  it("tracks adapter lifecycle events", async () => {
    TelemetryMetrics.recordAdapterConnect("adapter_ready");
    TelemetryMetrics.recordAdapterError("adapter_init_failure");
    TelemetryMetrics.recordAdapterHeartbeat(12345);

    const connectMetric = registry.getSingleMetric("adapter_connect_total");
    const connectSnapshot = await connectMetric?.get();
    const connectValues = connectSnapshot?.values ?? [];
    const readySample = connectValues.find((sample) => sample.value === 1);
    expect(readySample?.labels?.event).toBe("adapter_ready");

    const errorMetric = registry.getSingleMetric("adapter_error_total");
    const errorSnapshot = await errorMetric?.get();
    const errorValues = errorSnapshot?.values ?? [];
    expect(errorValues[0]?.labels?.event).toBe("adapter_init_failure");

    const heartbeatMetric = registry.getSingleMetric(
      "adapter_last_heartbeat_ms",
    );
    const heartbeatSnapshot = await heartbeatMetric?.get();
    const heartbeatValues = heartbeatSnapshot?.values ?? [];
    expect(heartbeatValues[0]?.value).toBe(12345);
  });

  it("records socket disconnect reasons", async () => {
    TelemetryMetrics.recordDisconnect("heartbeat_timeout");
    TelemetryMetrics.recordDisconnect("transport_error");

    const metric = registry.getSingleMetric("socket_disconnect_total");
    const snapshot = await metric?.get();
    const values = snapshot?.values ?? [];
    const heartbeat = values.find(
      (sample) => sample.labels.reason === "heartbeat_timeout",
    );
    const transport = values.find(
      (sample) => sample.labels.reason === "transport_error",
    );
    expect(heartbeat?.value).toBe(1);
    expect(transport?.value).toBe(1);
  });

  it("tracks presence registry activity", async () => {
    TelemetryMetrics.incrementPresenceWrite("connect");
    TelemetryMetrics.incrementPresenceWrite("disconnect");
    TelemetryMetrics.incrementHeartbeatExtend("success");
    TelemetryMetrics.incrementHeartbeatExtend("error");

    const presenceMetric = registry.getSingleMetric("registry_write_total");
    const presenceSnapshot = await presenceMetric?.get();
    const presenceValues = presenceSnapshot?.values ?? [];
    const connectSample = presenceValues.find(
      (sample) => sample.labels.event === "connect",
    );
    const disconnectSample = presenceValues.find(
      (sample) => sample.labels.event === "disconnect",
    );
    expect(connectSample?.value).toBe(1);
    expect(disconnectSample?.value).toBe(1);

    const heartbeatMetric = registry.getSingleMetric("heartbeat_extend_total");
    const heartbeatSnapshot = await heartbeatMetric?.get();
    const heartbeatValues = heartbeatSnapshot?.values ?? [];
    const successSample = heartbeatValues.find(
      (sample) => sample.labels.event === "success",
    );
    const errorSample = heartbeatValues.find(
      (sample) => sample.labels.event === "error",
    );
    expect(successSample?.value).toBe(1);
    expect(errorSample?.value).toBe(1);
  });
});
