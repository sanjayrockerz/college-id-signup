# JWT and Password Utilities Documentation

## Overview

This directory contains utility functions for JSON Web Token (JWT) operations and password hashing/comparison using industry-standard libraries.

## Files Created

### 1. JWT Utilities
- **File**: `src/utils/jwt.js` (JavaScript)
- **File**: `src/utils/jwt.ts` (TypeScript)
- **Dependencies**: `jsonwebtoken` package

### 2. Password Utilities  
- **File**: `src/utils/password.js` (JavaScript)
- **File**: `src/utils/password.ts` (TypeScript)
- **Dependencies**: `bcrypt` package (with crypto fallback)

### 3. Example Usage
- **File**: `src/utils/example-usage.js` (JavaScript examples)
- **File**: `src/utils/example-usage.ts` (TypeScript examples)

## JWT Utilities

### `generateToken(payload)`
Creates a signed JWT token with a 7-day expiration.

**Parameters:**
- `payload` (Object): The data to encode in the token

**Returns:**
- `string`: The signed JWT token

**Example:**
```javascript
const token = generateToken({
  sub: 'user123',
  username: 'john_doe',
  email: 'john@example.com'
});
```

### `verifyToken(token)`
Verifies and decodes a JWT token.

**Parameters:**
- `token` (string): The JWT token to verify

**Returns:**
- `Object`: The decoded payload

**Throws:**
- `Error`: If the token is invalid or expired

**Example:**
```javascript
try {
  const decoded = verifyToken(token);
  console.log('User ID:', decoded.sub);
} catch (error) {
  console.error('Invalid token:', error.message);
}
```

## Password Utilities

### `hashPassword(plainPassword)`
Hashes a plain text password using bcrypt with salt rounds 12.

**Parameters:**
- `plainPassword` (string): The plain text password to hash

**Returns:**
- `Promise<string>`: The hashed password

**Example:**
```javascript
const hashedPassword = await hashPassword('myPassword123');
```

### `comparePassword(plainPassword, hashedPassword)`
Compares a plain text password with a hashed password.

**Parameters:**
- `plainPassword` (string): The plain text password
- `hashedPassword` (string): The hashed password to compare against

**Returns:**
- `Promise<boolean>`: True if passwords match, false otherwise

**Example:**
```javascript
const isValid = await comparePassword('myPassword123', hashedPassword);
if (isValid) {
  console.log('Password is correct');
}
```

## Environment Configuration

### Required Environment Variables
```env
JWT_SECRET=your-secret-key-here
```

**Important**: In production, use a strong, random JWT secret. The utilities fall back to 'defaultSecret' if not set, but this should only be used for development.

## Security Features

### JWT Security
- **Expiration**: Tokens expire in 7 days
- **Secret**: Uses environment variable for signing key
- **Error Handling**: Proper error messages for invalid/expired tokens

### Password Security
- **Salt Rounds**: Uses 12 rounds for bcrypt (industry standard)
- **Fallback**: Uses Node.js crypto PBKDF2 if bcrypt unavailable
- **Timing**: Async operations prevent blocking

## Usage in Authentication

### Login Flow Example
```javascript
const { generateToken } = require('./utils/jwt');
const { comparePassword } = require('./utils/password');

async function login(email, password) {
  // 1. Find user by email
  const user = await findUserByEmail(email);
  
  // 2. Verify password
  const isValidPassword = await comparePassword(password, user.hashedPassword);
  
  if (!isValidPassword) {
    throw new Error('Invalid credentials');
  }
  
  // 3. Generate token
  const token = generateToken({
    sub: user.id,
    username: user.username,
    email: user.email
  });
  
  return { token, user };
}
```

### Registration Flow Example
```javascript
const { hashPassword } = require('./utils/password');

async function register(userData) {
  // 1. Hash password
  const hashedPassword = await hashPassword(userData.password);
  
  // 2. Save user with hashed password
  const user = await createUser({
    ...userData,
    password: hashedPassword
  });
  
  return user;
}
```

### Middleware Example
```javascript
const { verifyToken } = require('./utils/jwt');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
```

## Error Handling

### JWT Errors
- **Invalid token format**: Malformed JWT structure
- **Expired token**: Token past expiration time
- **Invalid signature**: Token has been tampered with
- **Missing secret**: JWT_SECRET not configured

### Password Errors
- **Hashing failure**: Bcrypt operation failed
- **Comparison failure**: Password comparison failed
- **Invalid input**: Empty or null passwords

## Testing

Run the example files to test the utilities:

```bash
# JavaScript version
node src/utils/example-usage.js

# TypeScript version (requires ts-node)
npx ts-node src/utils/example-usage.ts
```

## Dependencies

### Required Packages
- `jsonwebtoken`: JWT signing and verification
- `bcrypt`: Password hashing (with crypto fallback)

### Development Dependencies  
- `@types/jsonwebtoken`: TypeScript types for JWT
- `@types/bcrypt`: TypeScript types for bcrypt

## Integration with Existing Codebase

These utilities are designed to work with:
- The existing NestJS authentication system
- The chat backend authentication
- Any custom authentication middleware
- Database user models requiring password hashing

## Performance Considerations

- **JWT**: Stateless tokens reduce database lookups
- **Password Hashing**: 12 salt rounds balance security and performance
- **Async Operations**: Non-blocking password operations
- **Fallback**: Crypto fallback ensures functionality even without bcrypt

## Production Deployment

1. **Set Strong JWT Secret**: Use a cryptographically secure random string
2. **Environment Variables**: Ensure JWT_SECRET is properly configured
3. **HTTPS Only**: JWT tokens should only be transmitted over HTTPS
4. **Token Storage**: Store tokens securely on client side
5. **Rotation**: Consider implementing token refresh mechanisms

The utilities are now ready for production use with comprehensive error handling and security best practices!
