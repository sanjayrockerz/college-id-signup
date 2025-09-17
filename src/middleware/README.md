# Authentication Middleware

This directory contains authentication middleware for both HTTP requests (Express) and real-time connections (Socket.IO).

## Files

### HTTP Authentication Middleware
- `auth.js` - JavaScript implementation for Express middleware
- `auth.ts` - TypeScript implementation for Express middleware

### Socket.IO Authentication Middleware
- `socketAuth.js` - JavaScript implementation for Socket.IO middleware
- `socketAuth.ts` - TypeScript implementation for Socket.IO middleware

## Usage

### Express/HTTP Middleware

```javascript
// JavaScript
const { authenticateToken } = require('./middleware/auth');

// Apply to specific routes
app.get('/protected', authenticateToken, (req, res) => {
  console.log('Authenticated user:', req.user);
  res.json({ message: 'Access granted', user: req.user });
});

// Apply to all routes
app.use('/api', authenticateToken);
```

```typescript
// TypeScript
import { authenticateToken } from './middleware/auth';

// Apply to specific routes
app.get('/protected', authenticateToken, (req, res) => {
  console.log('Authenticated user:', req.user);
  res.json({ message: 'Access granted', user: req.user });
});
```

### Socket.IO Middleware

```javascript
// JavaScript
const { socketAuthMiddleware } = require('./middleware/socketAuth');

const io = require('socket.io')(server);

// Apply authentication middleware
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  console.log('Authenticated user connected:', socket.user);
  
  socket.on('message', (data) => {
    // socket.userId and socket.user are available
    console.log(`Message from ${socket.user.username}: ${data}`);
  });
});
```

```typescript
// TypeScript
import { socketAuthMiddleware } from './middleware/socketAuth';

const io = require('socket.io')(server);

// Apply authentication middleware
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  console.log('Authenticated user connected:', socket.user);
  
  socket.on('message', (data) => {
    // socket.userId and socket.user are available
    console.log(`Message from ${socket.user.username}: ${data}`);
  });
});
```

## Client-Side Authentication

### HTTP Requests
Include the JWT token in the Authorization header:

```javascript
// Fetch API
fetch('/api/protected', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// Axios
axios.get('/api/protected', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Socket.IO Connection
Pass the token in the auth object or headers:

```javascript
// Method 1: Using auth object (recommended)
const socket = io('http://localhost:3000', {
  auth: {
    token: userToken
  }
});

// Method 2: Using headers
const socket = io('http://localhost:3000', {
  extraHeaders: {
    Authorization: `Bearer ${userToken}`
  }
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
