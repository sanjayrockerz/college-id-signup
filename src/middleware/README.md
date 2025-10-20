# Middleware# Authentication Middleware



This directory contains middleware for the College Social Platform API.This directory contains authentication middleware for both HTTP requests (Express) and real-time connections (Socket.IO).



## Available Middleware## Files



### Rate Limiting (`rateLimiter.js` / `rateLimiter.ts`)### HTTP Authentication Middleware

- `auth.js` - JavaScript implementation for Express middleware

Rate limiting middleware to protect public API endpoints from abuse. Since the API operates without authentication, rate limits are enforced by IP address.- `auth.ts` - TypeScript implementation for Express middleware



**Rate Limit Tiers:**### Socket.IO Authentication Middleware

- `socketAuth.js` - JavaScript implementation for Socket.IO middleware

| Limiter | Window | Max Requests | Applied To |- `socketAuth.ts` - TypeScript implementation for Socket.IO middleware

|---------|--------|--------------|------------|

| `apiLimiter` | 15 min | 100 | All endpoints (default) |## Usage

| `messagingLimiter` | 15 min | 200 | Messaging endpoints |

| `uploadLimiter` | 15 min | 10 | File upload endpoints |### Express/HTTP Middleware

| `adminLimiter` | 15 min | 20 | Admin operations |

| `writeOperationLimiter` | 15 min | 30 | POST/PUT/DELETE requests |```javascript

// JavaScript

**Usage:**const { authenticateToken } = require('./middleware/auth');



```javascript// Apply to specific routes

// JavaScriptapp.get('/protected', authenticateToken, (req, res) => {

const { apiLimiter, uploadLimiter, adminLimiter } = require('./middleware/rateLimiter');  console.log('Authenticated user:', req.user);

  res.json({ message: 'Access granted', user: req.user });

// Apply general rate limiting to all routes});

app.use(apiLimiter);

// Apply to all routes

// Apply specific limiters to certain routesapp.use('/api', authenticateToken);

app.use('/api/upload', uploadLimiter, uploadRoutes);```

app.use('/api/admin', adminLimiter, adminRoutes);

``````typescript

// TypeScript

```typescriptimport { authenticateToken } from './middleware/auth';

// TypeScript

import { apiLimiter, uploadLimiter, adminLimiter } from './middleware/rateLimiter';// Apply to specific routes

app.get('/protected', authenticateToken, (req, res) => {

// Apply general rate limiting to all routes  console.log('Authenticated user:', req.user);

app.use(apiLimiter);  res.json({ message: 'Access granted', user: req.user });

});

// Apply specific limiters to certain routes```

app.use('/api/upload', uploadLimiter, uploadRoutes);

app.use('/api/admin', adminLimiter, adminRoutes);### Socket.IO Middleware

```

```javascript

**Response Headers:**// JavaScript

const { socketAuthMiddleware } = require('./middleware/socketAuth');

When rate limits are active, the following headers are included in responses:

const io = require('socket.io')(server);

- `RateLimit-Limit`: Total requests allowed in the window

- `RateLimit-Remaining`: Requests remaining in current window// Apply authentication middleware

- `RateLimit-Reset`: Timestamp when the limit resetsio.use(socketAuthMiddleware);



**Error Response (429):**io.on('connection', (socket) => {

  console.log('Authenticated user connected:', socket.user);

```json  

{  socket.on('message', (data) => {

  "success": false,    // socket.userId and socket.user are available

  "error": "Rate limit exceeded",    console.log(`Message from ${socket.user.username}: ${data}`);

  "message": "Too many requests from this IP address. Please try again later.",  });

  "retryAfter": "in 15 minutes"});

}```

```

```typescript

## Security Considerations// TypeScript

import { socketAuthMiddleware } from './middleware/socketAuth';

⚠️ **No Authentication:** This API operates without authentication. Rate limiting by IP address is the primary security control.

const io = require('socket.io')(server);

**Best Practices:**

1. All endpoints should validate `userId` parameter presence// Apply authentication middleware

2. Server-side validation on all inputs is criticalio.use(socketAuthMiddleware);

3. Monitor rate limit violations for abuse patterns

4. Consider implementing authentication before production deploymentio.on('connection', (socket) => {

  console.log('Authenticated user connected:', socket.user);

## Configuration  

  socket.on('message', (data) => {

Rate limits can be adjusted in `rateLimiter.js` / `rateLimiter.ts` by modifying:    // socket.userId and socket.user are available

- `windowMs`: Time window in milliseconds    console.log(`Message from ${socket.user.username}: ${data}`);

- `max`: Maximum number of requests per window  });

- `message`: Custom error message});

```

**Example:**

## Client-Side Authentication

```javascript

const customLimiter = rateLimit({### HTTP Requests

  windowMs: 10 * 60 * 1000, // 10 minutesInclude the JWT token in the Authorization header:

  max: 50, // 50 requests per window

  message: {```javascript

    success: false,// Fetch API

    error: 'Custom rate limit exceeded'fetch('/api/protected', {

  }  headers: {

});    'Authorization': `Bearer ${token}`

```  }

});

## Adding New Middleware

// Axios

To add new middleware:axios.get('/api/protected', {

  headers: {

1. Create the middleware file in this directory    'Authorization': `Bearer ${token}`

2. Export the middleware function  }

3. Add documentation to this README});

4. Apply the middleware in your app configuration```



**Template:**### Socket.IO Connection

Pass the token in the auth object or headers:

```javascript

// Example: loggerMiddleware.js```javascript

const loggerMiddleware = (req, res, next) => {// Method 1: Using auth object (recommended)

  console.log(`${req.method} ${req.path}`);const socket = io('http://localhost:3000', {

  next();  auth: {

};    token: userToken

  }

module.exports = { loggerMiddleware };});

```

// Method 2: Using headers

## See Alsoconst socket = io('http://localhost:3000', {

  extraHeaders: {

- [API Documentation](../../API_DOCUMENTATION.md) - Complete API reference with rate limit details    Authorization: `Bearer ${userToken}`

- [Express Rate Limit](https://www.npmjs.com/package/express-rate-limit) - Rate limiting package documentation  }

});
```

## Authentication Flow

### HTTP Middleware
1. Extract token from `Authorization: Bearer <token>` header
2. Verify token using JWT utilities
3. Look up user in database using token's `sub` (user ID)
4. Attach user data to `req.user`, `req.userId`, and `req.tokenPayload`
5. Call `next()` to proceed to route handler

### Socket.IO Middleware
1. Extract token from `socket.handshake.auth.token` or `Authorization` header
2. Verify token using JWT utilities
3. Look up user in database using token's `sub` (user ID)
4. Attach user data to `socket.user`, `socket.userId`, and `socket.tokenPayload`
5. Call `next()` to allow connection

## Error Handling

Both middlewares provide comprehensive error handling:

### HTTP Errors
- `401 NO_TOKEN` - No authorization token provided
- `403 INVALID_TOKEN` - Token format is invalid or expired
- `403 USER_NOT_FOUND` - User associated with token doesn't exist
- `500 DATABASE_ERROR` - Database connection issues

### Socket.IO Errors
- `NO_TOKEN` - No authorization token provided
- `INVALID_TOKEN` - Token format is invalid or expired
- `USER_NOT_FOUND` - User associated with token doesn't exist
- `DATABASE_ERROR` - Database connection issues

## Helper Functions

### HTTP Helpers
```javascript
const { getRequestUser, getRequestUserId, isRequestAuthenticated } = require('./middleware/auth');

// Get authenticated user
const user = getRequestUser(req);

// Get user ID
const userId = getRequestUserId(req);

// Check if authenticated
if (isRequestAuthenticated(req)) {
  // User is authenticated
}
```

### Socket.IO Helpers
```javascript
const { getSocketUser, getSocketUserId, isSocketAuthenticated } = require('./middleware/socketAuth');

// Get authenticated user
const user = getSocketUser(socket);

// Get user ID
const userId = getSocketUserId(socket);

// Check if authenticated
if (isSocketAuthenticated(socket)) {
  // Socket is authenticated
}
```

## Security Features

1. **JWT Verification**: Uses secure JWT verification with signature validation
2. **User Validation**: Verifies user still exists in database
3. **Data Filtering**: Only includes safe user fields (no password/sensitive data)
4. **Error Details**: Detailed errors in development, minimal in production
5. **Token Expiration**: Handles expired tokens gracefully
6. **Database Fallback**: Graceful handling of database connection issues

## Dependencies

- JWT utilities (`../utils/jwt`)
- Database singleton (`../config/database`)
- Prisma client for user lookup
- Express (for HTTP middleware)
- Socket.IO (for Socket.IO middleware)

## Environment Support

- Works in both development and production environments
- Graceful fallback for missing dependencies
- Debug logging in development mode
- Comprehensive error reporting
