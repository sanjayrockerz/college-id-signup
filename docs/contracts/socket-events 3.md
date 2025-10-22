# Socket.IO Event Contracts (v2.0.0)

## Events

### join

- Payload:

```ts
interface JoinEvent {
  conversationId: string;
  userId: string;
  timestamp: number; // ms since epoch
}
```

- Ack: `{ joined: true }`

### leave

- Payload: `JoinEvent`
- Ack: `{ left: true }`

### message:send

- Payload:

```ts
interface SendMessageEvent {
  conversationId: string;
  userId: string;
  content: string; // <= 10k chars
  messageId?: string; // client-generated for dedupe
  timestamp: number; // ms since epoch
}
```

- Ack: `{ messageId: string }`

### message:receive (server->client)

- Payload:

```ts
interface ReceiveMessageEvent {
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  timestamp: number; // ms since epoch
}
```

- Ack (optional): `{ received: true }`

### typing

- Payload: `{ conversationId: string; userId: string; typing: boolean; timestamp: number }`
- Ack: none

### error

- Payload: `{ error: { code: string; message: string; details?: Record<string, any> } }`
- Ack: none

## Ordering & Reliability

- Per-conversation ordering is best-effort by send time; no global ordering.
- Client retries `message:send` if no ack within 5s.
- Server deduplicates by `messageId`.
- Sticky sessions required across instances; Redis adapter for cross-instance fanout.
