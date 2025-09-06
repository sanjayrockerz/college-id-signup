# Database Singleton Client

This directory contains the singleton Prisma client implementation for the college chat application. The singleton pattern ensures that only one database connection is created and reused throughout the application, preventing connection pool exhaustion and improving performance.

## Files

- `database.js` - JavaScript implementation of the singleton client
- `database.ts` - TypeScript implementation with full type safety
- `database.examples.ts` - Usage examples and patterns
- `README.md` - This documentation file

## Features

### 🚀 **Singleton Pattern**
- Single database connection instance across the entire application
- Prevents multiple connection creation and pool exhaustion
- Hot reload support in development with global variable attachment

### 🔍 **Environment-Aware Logging**
- **Development**: Detailed query logging with execution time and parameters
- **Production**: Error-only logging for performance and security

### 🛡️ **Error Handling**
- Graceful connection management
- Automatic reconnection attempts
- Process termination handlers for clean shutdown

### 📊 **Health Monitoring**
- Database health check functionality
- Connection metrics and monitoring
- Latency measurement

### 🔄 **Transaction Support**
- Wrapper for Prisma's transaction functionality
- Type-safe transaction callbacks
- Error handling and rollback

## Usage Examples

### Basic Usage

```typescript
import { prisma } from '../config/database';

// Simple query
const user = await prisma.user.findUnique({
  where: { id: userId },
});

// Complex query with relations
const posts = await prisma.post.findMany({
  where: { authorId: userId },
  include: {
    author: true,
    interactions: true,
  },
});
```

### Transaction Usage

```typescript
import { executeTransaction } from '../config/database';

const result = await executeTransaction(async (tx) => {
  const user = await tx.user.create({
    data: { email, username },
  });
  
  const profile = await tx.post.create({
    data: { content: 'Welcome!', authorId: user.id },
  });
  
  return { user, profile };
});
```

### Health Check

```typescript
import { checkDatabaseHealth, getDatabaseMetrics } from '../config/database';

// Basic health check
const health = await checkDatabaseHealth();
console.log(health.status); // 'healthy' or 'unhealthy'

// Detailed metrics
const metrics = getDatabaseMetrics();
console.log(metrics.activeConnections);
```

### Application Lifecycle

```typescript
import { connectDatabase, disconnectDatabase } from '../config/database';

// Application startup
async function startApp() {
  await connectDatabase();
  // Start your server...
}

// Application shutdown
async function stopApp() {
  // Stop your server...
  await disconnectDatabase();
}
```

## Configuration

### Environment Variables

Set these in your `.env` file:

```bash
# Primary database URL (recommended)
DATABASE_URL="postgresql://username:password@localhost:5432/database_name"

# Alternative individual settings
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=college_chat_db
DB_SCHEMA=public
DB_SSL=false

# Connection pool settings
DB_POOL_SIZE=10
DB_CONNECTION_TIMEOUT=10000
DB_QUERY_TIMEOUT=30000

# Logging
DB_LOGGING=true
NODE_ENV=development
```

### NestJS Integration

To use the singleton in your NestJS services:

```typescript
import { Injectable } from '@nestjs/common';
import { prisma } from '../../config/database';

@Injectable()
export class UserService {
  async findUser(id: string) {
    return await prisma.user.findUnique({
      where: { id },
    });
  }
}
```

## Chat-Specific Models

The database schema includes models specifically designed for chat functionality:

### Core Models

- **User** - Extended with chat presence and online status
- **Conversation** - Direct messages, group chats, and channels
- **ConversationUser** - Join table for conversation membership and roles
- **Message** - Messages with support for threads, replies, and reactions
- **MessageRead** - Read receipts and delivery status
- **Attachment** - File uploads and media sharing

### Optimizations

The schema includes performance optimizations:

- **Composite indexes** on `(conversationId, createdAt)` for messages
- **Composite indexes** on `(userId, conversationId)` for conversation users
- **Single indexes** on `updatedAt` for conversation sorting
- **Cascading deletes** for data integrity

## Best Practices

### 1. Always Use the Singleton

```typescript
// ✅ Good - Use the singleton
import { prisma } from '../config/database';

// ❌ Bad - Don't create new instances
import { PrismaClient } from '@prisma/client';
const newPrisma = new PrismaClient();
```

### 2. Use Transactions for Related Operations

```typescript
// ✅ Good - Atomic operations
await executeTransaction(async (tx) => {
  await tx.user.create({ data: userData });
  await tx.post.create({ data: postData });
});

// ❌ Bad - Non-atomic operations
await prisma.user.create({ data: userData });
await prisma.post.create({ data: postData });
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Good - Error handling
try {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
} catch (error) {
  logger.error('Failed to find user:', error);
  throw error;
}
```

### 4. Use Type-Safe Queries

```typescript
// ✅ Good - Type-safe with includes
const user = await prisma.user.findUnique({
  where: { id },
  include: {
    posts: true,
    connections: true,
  },
});

// ✅ Good - Type-safe with select
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    username: true,
    email: true,
  },
});
```

## Monitoring and Debugging

### Health Check Endpoint

```typescript
import { checkDatabaseHealth } from '../config/database';

app.get('/health/database', async (req, res) => {
  const health = await checkDatabaseHealth();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

### Logging Configuration

The singleton automatically configures logging based on the environment:

- **Development**: Full query logging with parameters and execution time
- **Production**: Error-only logging for security and performance

### Connection Monitoring

Use the metrics function to monitor connection usage:

```typescript
import { getDatabaseMetrics } from '../config/database';

setInterval(() => {
  const metrics = getDatabaseMetrics();
  console.log('Active connections:', metrics.activeConnections);
}, 30000);
```

## Migration and Schema Updates

After updating the Prisma schema:

1. Generate the client: `npm run prisma:generate`
2. Create migration: `npm run prisma:migrate`
3. Apply to database: The singleton will automatically use the new schema

## Troubleshooting

### Common Issues

1. **Connection Pool Exhaustion**
   - Ensure you're using the singleton, not creating new clients
   - Check for unclosed connections in your code

2. **Hot Reload Issues in Development**
   - The singleton handles this automatically with global variable attachment
   - Restart the development server if issues persist

3. **Type Errors After Schema Changes**
   - Run `npm run prisma:generate` to update types
   - Restart your TypeScript server

### Debug Mode

Enable detailed logging in development:

```bash
DB_LOGGING=true
NODE_ENV=development
```

This will show all queries, parameters, and execution times in the console.
