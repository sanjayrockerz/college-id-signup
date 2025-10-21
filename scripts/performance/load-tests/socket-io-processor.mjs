import crypto from "crypto";

export function assignConversation(context, events, done) {
  const randomSuffix = crypto.randomInt(1, 1000000);
  const conversationId = `perf-conversation-${randomSuffix}`;
  context.vars.conversationId = conversationId;
  return done();
}

export function buildMessage(context, events, done) {
  const randomFragment = crypto.randomBytes(6).toString("hex");
  context.vars.messageContent = `Load test message ${randomFragment}`;
  return done();
}

export function randomNumber(min, max) {
  const lower = Number(min);
  const upper = Number(max);
  if (Number.isNaN(lower) || Number.isNaN(upper) || upper <= lower) {
    return 1;
  }
  return Math.floor(Math.random() * (upper - lower + 1) + lower);
}

export function beforeRequest(context, events, done) {
  events.emit("counter", "activeUsers", 1);
  return done();
}
