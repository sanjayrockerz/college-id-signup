import * as jwt from 'jsonwebtoken';

/**
 * Generate a JWT token with the provided payload
 * @param payload - The data to encode in the token
 * @returns The signed JWT token
 */
export function generateToken(payload: object): string {
  const secret = process.env.JWT_SECRET || 'defaultSecret';
  const options: jwt.SignOptions = {
    expiresIn: '7d', // Token expires in 7 days
  };
  
  return jwt.sign(payload, secret, options);
}

/**
 * Verify and decode a JWT token
 * @param token - The JWT token to verify
 * @returns The decoded payload
 * @throws Throws an error if the token is invalid
 */
export function verifyToken(token: string): any {
  const secret = process.env.JWT_SECRET || 'defaultSecret';
  
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}
