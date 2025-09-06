# Database Connection Status and Setup Guide

## Current Status: MOCK DATABASE

The application is currently running with a **mock Prisma client** for development purposes. This means:

- ✅ All TypeScript compilation errors are resolved
- ✅ All modules, services, and controllers are properly wired
- ✅ The application can start and serve requests
- ⚠️ No real database connection is established
- ⚠️ Data is not persisted between restarts

## Health Check Endpoint

Once the server is running, you can check the database connection status at:
- `GET /health` - Overall application health
- `GET /health/database` - Detailed database connection information

## To Establish Real Database Connection

### Option 1: Using Docker (Recommended)

1. **Start the database containers:**
   ```bash
   docker-compose up -d
   ```
   This will start PostgreSQL and Redis containers with the correct configuration.

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Generate Prisma client:**
   ```bash
   npm run prisma:generate
   ```

4. **Run migrations:**
   ```bash
   npm run prisma:migrate
   ```

5. **Seed the database:**
   ```bash
   npm run prisma:seed
   ```

6. **Update Prisma service to use real client:**
   
   Edit `src/infra/prisma/prisma.service.ts`:
   ```typescript
   import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
   import { PrismaClient } from '@prisma/client';  // Remove mock import
   // import { PrismaClient } from './mock-prisma-client';  // Comment this out

   @Injectable()
   export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
     async onModuleInit() {
       await this.$connect();
     }

     async onModuleDestroy() {
       await this.$disconnect();
     }
   }
   ```

### Option 2: Local PostgreSQL Installation

1. **Install PostgreSQL 14+** on your system

2. **Create database:**
   ```sql
   CREATE DATABASE college_social_db;
   CREATE USER college_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE college_social_db TO college_user;
   ```

3. **Update `.env` file:**
   ```bash
   DATABASE_URL="postgresql://college_user:your_password@localhost:5432/college_social_db?schema=public"
   ```

4. **Follow steps 2-6 from Option 1**

### Option 3: Cloud Database (Production)

1. **Set up a PostgreSQL instance** on your preferred cloud provider:
   - AWS RDS
   - Google Cloud SQL
   - Azure Database for PostgreSQL
   - Supabase
   - PlanetScale
   - Railway

2. **Update `.env` with your cloud database URL:**
   ```bash
   DATABASE_URL="postgresql://username:password@host:port/database?schema=public"
   ```

3. **Follow steps 2-6 from Option 1**

## Verification Steps

After setting up the real database:

1. **Check the health endpoint:**
   ```bash
   curl http://localhost:3001/health/database
   ```
   Should return `"status": "connected"` instead of `"status": "mock"`

2. **Verify tables exist:**
   ```bash
   npm run prisma:studio
   ```
   This opens a GUI to browse your database

3. **Test API endpoints:**
   - Create a user: `POST /api/v1/users`
   - Create a post: `POST /api/v1/posts`
   - Check feed: `GET /api/v1/feed`

## Current Mock Behavior

While using the mock client:
- All API endpoints will work
- Mock data is returned (not real database data)
- No data persistence between server restarts
- All operations return success responses
- Count operations return fixed numbers (0 or sample counts)

## Troubleshooting

### Connection Issues
- Check if PostgreSQL is running: `docker ps` or `systemctl status postgresql`
- Verify DATABASE_URL in `.env` file
- Check firewall/network connectivity
- Ensure database and user exist

### Migration Issues
- Reset database: `npm run db:reset` (⚠️ DELETES ALL DATA)
- Check Prisma schema syntax
- Verify Prisma CLI is installed: `npx prisma --version`

### Permission Issues
- Check database user permissions
- Verify schema ownership
- Check connection pool limits

## Next Steps

1. **Choose your database setup option** (Docker recommended for development)
2. **Follow the setup steps** for your chosen option
3. **Verify connection** using the health endpoints
4. **Run integration tests** to ensure everything works
5. **Deploy** to your preferred hosting platform

## Production Considerations

- Use environment-specific `.env` files
- Enable SSL for database connections
- Set up connection pooling
- Configure database backup strategy
- Monitor database performance
- Set up logging and alerting
