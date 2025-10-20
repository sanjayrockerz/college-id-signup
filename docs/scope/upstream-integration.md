# Upstream Integration Guide

**Target Audience**: Developers building services that call this chat backend  
**Version**: 1.0  
**Last Updated**: October 20, 2025

---

## Overview

This document describes how upstream services (API gateways, authentication services, application backends) should integrate with the chat backend.

---

## Integration Contract

### Identity Context

**userId Parameter**:
- **Type**: String (opaque identifier)
- **Required**: Optional in most endpoints, required in some
- **Validation**: This service does NOT validate userId against any user registry
- **Format**: Any string format is accepted (UUID, numeric, alphanumeric)
- **Usage**: Message attribution, conversation participant identification
- **Authorization**: NOT used for access control decisions

**Example valid userId values**:
```
"user-123"
"550e8400-e29b-41d4-a716-446655440000"
"john.doe@example.com"
"12345"
```

---

## HTTP API Integration

### Request Format

**Include userId in**:
- **Request Body** (preferred for POST/PUT)
- **Query Parameters** (acceptable for GET)

**Do NOT**:
- Use Authorization header (this service ignores it)
- Use cookies or sessions
- Expect 401/403 responses

### Example Requests

#### Create Conversation
```http
POST /api/chat/conversations
Content-Type: application/json

{
  "userId": "current-user-id",
  "participantIds": ["user-1", "user-2", "user-3"],
  "title": "Project Discussion"
}
```

#### Send Message
```http
POST /api/chat/conversations/:conversationId/messages
Content-Type: application/json

{
  "userId": "current-user-id",
  "content": "Hello team!",
  "messageType": "text"
}
```

#### Get Conversation History
```http
GET /api/chat/conversations/:conversationId/messages?userId=current-user-id&limit=50&before=2025-10-20T10:00:00Z
```

### Error Responses

**400 Bad Request**: Missing or invalid userId, validation failure
```json
{
  "success": false,
  "error": "Validation failed",
  "message": "userId is required"
}
```

**429 Too Many Requests**: Rate limit exceeded
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "message": "Too many requests from this IP address. Please try again later.",
  "retryAfter": "in 15 minutes"
}
```

**No 401/403 responses**: This service does not authenticate or authorize.

---

## Socket.IO Integration

### Connection Setup

**Provide userId in handshake query**:
```javascript
const socket = io('http://localhost:3001', {
  query: {
    userId: 'current-user-id'
  },
  transports: ['websocket', 'polling']
});
```

**Do NOT**:
- Send auth tokens in handshake
- Expect authentication during connection
- Assume connection validates identity

### Event Format

**All events should include userId in payload**:

#### Join Conversation
```javascript
socket.emit('join_conversation', {
  userId: 'current-user-id',
  conversationId: 'conv-123'
});
```

#### Send Message
```javascript
socket.emit('send_message', {
  userId: 'current-user-id',
  conversationId: 'conv-123',
  content: 'Hello!',
  messageType: 'text'
});
```

#### Typing Indicator
```javascript
socket.emit('typing_start', {
  userId: 'current-user-id',
  conversationId: 'conv-123'
});
```

### Receiving Events

```javascript
socket.on('message_received', (data) => {
  console.log('New message:', data);
  // data.userId contains sender (untrusted)
  // data.conversationId contains conversation
  // data.content contains message content
});

socket.on('user_typing', (data) => {
  console.log('User typing:', data.userId);
  // Show typing indicator for user
});
```

---

## Recommended Upstream Flow

### 1. Authentication Layer (Your Responsibility)

```javascript
// Example Express middleware in YOUR upstream service
async function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

### 2. Authorization Layer (Your Responsibility)

```javascript
// Example: Check if user can access conversation
async function canAccessConversation(req, res, next) {
  const { conversationId } = req.params;
  const userId = req.userId;
  
  // YOUR logic: Check if userId is participant in conversation
  const isParticipant = await checkConversationAccess(userId, conversationId);
  
  if (!isParticipant) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  next();
}
```

### 3. Forward to Chat Backend

```javascript
// Example: Proxy to chat backend with verified userId
app.post('/api/conversations/:conversationId/messages',
  authenticateUser,           // Your auth middleware
  canAccessConversation,      // Your authz middleware
  async (req, res) => {
    // Forward to chat backend with verified userId
    const response = await fetch(`${CHAT_BACKEND_URL}/api/chat/conversations/${req.params.conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: req.userId,      // From YOUR auth token
        content: req.body.content,
        messageType: req.body.messageType
      })
    });
    
    const data = await response.json();
    res.json(data);
  }
);
```

---

## Complete Integration Example

### Upstream API Gateway

```javascript
// gateway.js - YOUR authentication service

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');

const app = express();
const CHAT_BACKEND_URL = 'http://localhost:3001';

// Authentication middleware
function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Inject userId into requests to chat backend
function injectUserId(req, res, next) {
  if (req.method === 'POST' || req.method === 'PUT') {
    req.body.userId = req.userId;
  } else if (req.method === 'GET') {
    req.query.userId = req.userId;
  }
  next();
}

// Proxy to chat backend with userId injected
app.use('/api/chat',
  authenticateUser,
  injectUserId,
  createProxyMiddleware({
    target: CHAT_BACKEND_URL,
    changeOrigin: true,
    pathRewrite: {
      '^/api/chat': '/api/chat'
    }
  })
);

app.listen(3000, () => {
  console.log('Gateway running on port 3000');
});
```

### Client Application

```javascript
// client.js - YOUR frontend application

// 1. User logs in via YOUR gateway
const loginResponse = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

const { token } = await loginResponse.json();

// 2. Call gateway endpoints (which forward to chat backend)
const response = await fetch('http://localhost:3000/api/chat/conversations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`  // YOUR token
  },
  body: JSON.stringify({
    participantIds: ['user-1', 'user-2'],
    title: 'Team Chat'
  })
});

// Gateway authenticates, injects userId, forwards to chat backend
```

---

## Security Best Practices

### DO

✅ **Authenticate users in YOUR upstream service**
✅ **Validate userId before forwarding to chat backend**
✅ **Check conversation access permissions upstream**
✅ **Implement per-user rate limiting upstream**
✅ **Log all forwarded requests for audit**
✅ **Use HTTPS between services (TLS)**
✅ **Run chat backend on private network**
✅ **Validate all user inputs before forwarding**

### DON'T

❌ **Expose chat backend directly to public clients**
❌ **Trust userId from client requests**
❌ **Rely on chat backend for authorization**
❌ **Send sensitive data (passwords, tokens) to chat backend**
❌ **Assume chat backend validates user identity**
❌ **Skip access control checks in upstream**
❌ **Forward raw client requests without validation**

---

## Testing Integration

### Development Environment

```javascript
// For local testing WITHOUT authentication:

// 1. Call chat backend directly with any userId
const response = await fetch('http://localhost:3001/api/chat/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'test-user',  // Any value works
    participantIds: ['user-1', 'user-2']
  })
});

// 2. Connect Socket.IO without auth
const socket = io('http://localhost:3001', {
  query: { userId: 'test-user' }
});
```

**⚠️ WARNING**: This is for development only. Never do this in production.

### Production Environment

- Always route through authenticated upstream gateway
- Never expose chat backend ports publicly
- Implement network segmentation (VPC, firewall rules)
- Monitor for direct access attempts

---

## Troubleshooting

### "userId is required" Error

**Problem**: Chat backend returns 400 with "userId is required"

**Solution**: Ensure userId is included in:
- Request body (POST/PUT)
- Query parameters (GET)
- Socket.IO handshake query or event payload

### Rate Limit Exceeded

**Problem**: Chat backend returns 429

**Solution**: 
- Implement caching in upstream service
- Batch requests where possible
- Implement per-user rate limits upstream
- Contact chat backend team to adjust limits

### Messages Not Delivering

**Problem**: Messages sent but not received via Socket.IO

**Solution**:
- Verify Socket.IO connection established
- Check conversationId is correct
- Ensure recipient is connected and joined conversation
- Check chat backend logs for errors

### Access Control Not Working

**Problem**: Users can access conversations they shouldn't

**Solution**: Chat backend does NOT enforce access control. Implement in YOUR upstream service before forwarding requests.

---

## API Reference

For complete API documentation, see:
- [API_DOCUMENTATION.md](../API_DOCUMENTATION.md) - Full endpoint reference
- [Socket.IO Events](./socket-events.md) - Event schemas
- [Error Codes](./error-codes.md) - Error handling

---

## Support

**Questions about integration?**
- Review [No-Auth Policy](./no-auth-policy.md) for architecture rationale
- Check [API Documentation](../API_DOCUMENTATION.md) for endpoint details
- See [Examples](../examples/) for sample integrations

---

**Document Owner**: Backend Engineering Team  
**Last Updated**: October 20, 2025  
**Version**: 1.0
