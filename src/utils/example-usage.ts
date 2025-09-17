// TypeScript example usage of JWT and Password utilities

import { generateToken, verifyToken } from './jwt';
import { hashPassword, comparePassword } from './password';

// Interface for user payload
interface UserPayload {
  sub: string;
  username: string;
  email: string;
  role: string;
}

// Example JWT usage
console.log('=== JWT Utilities Example (TypeScript) ===');

// Create a sample payload
const userPayload: UserPayload = {
  sub: 'user123',
  username: 'john_doe',
  email: 'john@example.com',
  role: 'student'
};

// Generate token
const token: string = generateToken(userPayload);
console.log('Generated Token:', token.substring(0, 50) + '...');

// Verify token
try {
  const decoded = verifyToken(token);
  console.log('Decoded Payload:', decoded);
} catch (error) {
  console.error('Token verification failed:', (error as Error).message);
}

// Example Password hashing
console.log('\n=== Password Utilities Example (TypeScript) ===');

async function testPassword(): Promise<void> {
  const plainPassword: string = 'mySecretPassword123!';
  
  try {
    // Hash password
    const hashedPassword: string = await hashPassword(plainPassword);
    console.log('Original Password:', plainPassword);
    console.log('Hashed Password:', hashedPassword);
    
    // Compare passwords
    const isMatch: boolean = await comparePassword(plainPassword, hashedPassword);
    console.log('Password Match:', isMatch);
    
    // Test with wrong password
    const wrongPassword: string = 'wrongPassword';
    const isWrongMatch: boolean = await comparePassword(wrongPassword, hashedPassword);
    console.log('Wrong Password Match:', isWrongMatch);
    
  } catch (error) {
    console.error('Password hashing failed:', (error as Error).message);
  }
}

// Run password test
testPassword();

// Example error handling
console.log('\n=== Error Handling Examples (TypeScript) ===');

// Test invalid token
try {
  const invalidToken: string = 'invalid.token.here';
  verifyToken(invalidToken);
} catch (error) {
  console.log('Expected error for invalid token:', (error as Error).message);
}

// Test expired token (would need to wait or manipulate time)
console.log('Note: Token expires in 7 days from generation');

// Export utilities
export {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
};
