# Database Setup Instructions

## Prerequisites
- PostgreSQL 14+ installed and running
- Node.js 18+ installed
- npm or yarn package manager

## Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env file with your actual database credentials
# Example:
DATABASE_URL="postgresql://postgres:password@localhost:5432/college_social_db?schema=public"
```

### 3. Database Setup
```bash
# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed the database with sample data
npm run prisma:seed
```

### 4. Start the Application
```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## Available Scripts

### Database Management
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:seed` - Seed database with sample data
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run db:reset` - Reset database (USE WITH CAUTION)

### Development
- `npm run start:dev` - Start in development mode with hot reload
- `npm run start:debug` - Start in debug mode
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run test` - Run tests
- `npm run test:cov` - Run tests with coverage

## Database Schema Overview

### Core Entities
1. **User** - User profiles with college verification
2. **Post** - Social posts with visibility controls
3. **Connection** - Friend/connection relationships
4. **Interaction** - Likes, comments, shares, views
5. **CoolnessRating** - 1-5 star ratings for posts
6. **Push** - Weekly push notifications
7. **PostView** - View tracking for analytics

### Key Features
- Anonymous posting (2 per day limit)
- Connection-based visibility controls
- Weekly push quota system
- Coolness rating system
- GDPR-compliant audit logging

## API Endpoints

Once the server is running, available endpoints:

### Feed System
- `GET /api/v1/feed` - Get personalized feed
- `GET /api/v1/feed/connections` - Get connections-only feed
- `GET /api/v1/feed/trending` - Get trending posts

### Posts
- `POST /api/v1/posts` - Create new post
- `GET /api/v1/posts/:id` - Get specific post
- `PUT /api/v1/posts/:id` - Update post
- `DELETE /api/v1/posts/:id` - Delete post
- `POST /api/v1/posts/:id/view` - Record post view

### Users
- `GET /api/v1/users/me` - Get current user profile
- `PUT /api/v1/users/me` - Update current user
- `GET /api/v1/users/:id` - Get user by ID
- `GET /api/v1/users/me/limits` - Check posting/push limits

### Connections
- `POST /api/v1/connections` - Send connection request
- `GET /api/v1/connections` - Get user connections
- `PUT /api/v1/connections/:id` - Accept/reject request
- `DELETE /api/v1/connections/:id` - Remove connection

### Upload System
- `POST /api/v1/upload/image` - Upload and process ID images

## Testing

### Sample Data
The seed script creates:
- 3 sample users (verified college students)
- Various connection states (accepted, pending, close friends)
- Sample posts with different visibility levels
- Interactions (likes, shares)
- Coolness ratings

### Test Critical Paths
1. **Anonymous Post Limits**
   - Try creating 3 anonymous posts in 24 hours (should fail on 3rd)
2. **Feed Visibility**
   - Check that posts with `CLOSE_FRIENDS_ONLY` only appear to close friends
3. **View Counting**
   - Verify POST `/posts/{id}/view` increments view count properly

## Next Steps for Production

1. **Implement Authentication**
   - JWT-based auth with refresh tokens
   - Rate limiting on login attempts

2. **Add Redis Integration**
   - Caching for feed generation
   - Rate limiting storage
   - Session management

3. **Implement Push System**
   - Weekly quota enforcement
   - Real-time notifications

4. **Add ML Algorithm**
   - Connection-first feed ranking
   - Personalized content recommendations

5. **Security Hardening**
   - Input sanitization
   - CSRF protection
   - API rate limiting

6. **Monitoring & Logging**
   - Error tracking
   - Performance monitoring
   - GDPR-compliant audit logs
