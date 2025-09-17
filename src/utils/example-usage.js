// Example usage of JWT and Password utilities

const { generateToken, verifyToken } = require('./jwt');
const { hashPassword, comparePassword } = require('./password');

// Example JWT usage
console.log('=== JWT Utilities Example ===');

// Create a sample payload
const userPayload = {
  sub: 'user123',
  username: 'john_doe',
  email: 'john@example.com',
  role: 'student'
};

// Generate token
const token = generateToken(userPayload);
console.log('Generated Token:', token.substring(0, 50) + '...');

// Verify token
try {
  const decoded = verifyToken(token);
  console.log('Decoded Payload:', decoded);
} catch (error) {
  console.error('Token verification failed:', error.message);
}

// Example Password hashing
console.log('\n=== Password Utilities Example ===');

async function testPassword() {
  const plainPassword = 'mySecretPassword123!';
  
  try {
    // Hash password
    const hashedPassword = await hashPassword(plainPassword);
    console.log('Original Password:', plainPassword);
    console.log('Hashed Password:', hashedPassword);
    
    // Compare passwords
    const isMatch = await comparePassword(plainPassword, hashedPassword);
    console.log('Password Match:', isMatch);
    
    // Test with wrong password
    const wrongPassword = 'wrongPassword';
    const isWrongMatch = await comparePassword(wrongPassword, hashedPassword);
    console.log('Wrong Password Match:', isWrongMatch);
    
  } catch (error) {
    console.error('Password hashing failed:', error.message);
  }
}

// Run password test
testPassword();

// Example error handling
console.log('\n=== Error Handling Examples ===');

// Test invalid token
try {
  const invalidToken = 'invalid.token.here';
  verifyToken(invalidToken);
} catch (error) {
  console.log('Expected error for invalid token:', error.message);
}

// Test expired token (would need to wait or manipulate time)
console.log('Note: Token expires in 7 days from generation');

module.exports = {
  // Re-export utilities for easy access
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
};
