# College ID Signup API Documentation

## Overview

The College ID Signup API provides authentication, user management, and ID card verification services for college students. It features JWT-based authentication, real-time Socket.IO integration, and comprehensive security measures.

## Base URL

```
http://localhost:3001
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints

### Health Check

#### GET /health
Returns server health status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

#### GET /health/database
Returns database connection status.

**Response:**
```json
{
  "status": "OK",
  "database": "Connected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "student@college.edu",
  "password": "SecurePassword123!",
  "firstName": "John",
  "lastName": "Doe",
  "studentId": "STU12345",
  "phoneNumber": "+1234567890"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "user-uuid",
    "email": "student@college.edu",
    "firstName": "John",
    "lastName": "Doe",
    "studentId": "STU12345",
    "verificationStatus": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST /api/auth/login
Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "student@college.edu",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid",
    "email": "student@college.edu",
    "firstName": "John",
    "lastName": "Doe",
    "verificationStatus": "verified"
  }
}
```

#### GET /api/auth/me
Get current user profile (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "email": "student@college.edu",
    "firstName": "John",
    "lastName": "Doe",
    "studentId": "STU12345",
    "verificationStatus": "verified",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### PUT /api/auth/profile
Update user profile (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "+1987654321"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "id": "user-uuid",
    "firstName": "John",
    "lastName": "Smith",
    "phoneNumber": "+1987654321"
  }
}
```

#### PUT /api/auth/password
Change user password (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

#### POST /api/auth/logout
Logout user (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### ID Card Verification Endpoints

#### POST /api/id-card/upload
Upload ID card image for verification (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
- `idCard`: Image file (JPG, PNG, GIF - max 10MB)

**Response (200):**
```json
{
  "success": true,
  "message": "ID card uploaded successfully",
  "verification": {
    "id": "verification-uuid",
    "status": "pending",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/id-card/status
Get ID card verification status (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response (200):**
```json
{
  "success": true,
  "verification": {
    "id": "verification-uuid",
    "status": "approved",
    "uploadedAt": "2024-01-01T00:00:00.000Z",
    "reviewedAt": "2024-01-01T01:00:00.000Z",
    "reviewedBy": "admin-uuid",
    "comments": "ID verified successfully"
  }
}
```

#### PUT /api/id-card/resubmit
Resubmit ID card after rejection (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
- `idCard`: Image file (JPG, PNG, GIF - max 10MB)

**Response (200):**
```json
{
  "success": true,
  "message": "ID card resubmitted successfully",
  "verification": {
    "id": "verification-uuid",
    "status": "pending",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/id-card/admin/pending
Get pending verifications (admin only).

**Headers:**
```
Authorization: Bearer <admin-jwt-token>
```

**Response (200):**
```json
{
  "success": true,
  "pendingVerifications": [
    {
      "id": "verification-uuid",
      "user": {
        "id": "user-uuid",
        "email": "student@college.edu",
        "firstName": "John",
        "lastName": "Doe"
      },
      "uploadedAt": "2024-01-01T00:00:00.000Z",
      "imageUrl": "/uploads/id-cards/filename.jpg"
    }
  ]
}
```

#### PUT /api/id-card/admin/review/:verificationId
Review ID card verification (admin only).

**Headers:**
```
Authorization: Bearer <admin-jwt-token>
```

**Request Body:**
```json
{
  "action": "approve",
  "comments": "ID verified successfully"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Verification reviewed successfully",
  "verification": {
    "id": "verification-uuid",
    "status": "approved",
    "reviewedAt": "2024-01-01T01:00:00.000Z",
    "comments": "ID verified successfully"
  }
}
```

## Socket.IO Events

The API includes Socket.IO support for real-time features.

### Connection
```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Events

#### join_conversation
Join a conversation room.
```javascript
socket.emit('join_conversation', conversationId);
```

#### leave_conversation
Leave a conversation room.
```javascript
socket.emit('leave_conversation', conversationId);
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Common HTTP Status Codes

- **200**: Success
- **201**: Created
- **400**: Bad Request (validation errors, malformed data)
- **401**: Unauthorized (invalid/missing token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **409**: Conflict (duplicate email, etc.)
- **413**: Payload Too Large (file size limit)
- **500**: Internal Server Error

## Security

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### File Upload Restrictions
- Maximum file size: 10MB
- Allowed types: JPG, PNG, GIF
- Files are scanned and validated

### Rate Limiting
- Login attempts: 5 per minute per IP
- File uploads: 5 per hour per user
- Registration: 3 per hour per IP

## Environment Variables

Key environment variables needed:

```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://username:password@localhost:5432/database
JWT_SECRET=your-super-secret-key
FRONTEND_URL=http://localhost:3000
```

## Development

### Starting the Server
```bash
# Development with auto-restart
npm run start:express:dev

# Production
npm run start:express
```

### Database Operations
```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Open database browser
npm run prisma:studio
```

### Testing
```bash
# Run all tests
npm test

# Run integration tests
npm run test:e2e
```

## Support

For support and questions, please refer to the project documentation or contact the development team.
