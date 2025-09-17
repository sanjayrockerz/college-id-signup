const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token with the provided payload
 * @param {Object} payload - The data to encode in the token
 * @returns {string} - The signed JWT token
 */
function generateToken(payload) {
  const secret = process.env.JWT_SECRET || 'defaultSecret';
  const options = {
    expiresIn: '7d', // Token expires in 7 days
  };
  
  return jwt.sign(payload, secret, options);
}

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object} - The decoded payload
 * @throws {Error} - Throws an error if the token is invalid
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET || 'defaultSecret';
  
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

module.exports = {
  generateToken,
  verifyToken,
};
