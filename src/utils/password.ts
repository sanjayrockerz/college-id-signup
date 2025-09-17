// Try to import bcrypt, fall back to crypto if not available
let bcrypt: any;
try {
  bcrypt = require('bcrypt');
} catch (error) {
  // Fallback to Node.js crypto if bcrypt is not available
  const crypto = require('crypto');
  bcrypt = {
    hash: async (password: string, saltRounds: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err: any, derivedKey: Buffer) => {
          if (err) reject(err);
          resolve(salt + ':' + derivedKey.toString('hex'));
        });
      });
    },
    compare: async (password: string, hash: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        const [salt, originalHash] = hash.split(':');
        crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err: any, derivedKey: Buffer) => {
          if (err) reject(err);
          resolve(originalHash === derivedKey.toString('hex'));
        });
      });
    }
  };
}

/**
 * Hash a plain text password
 * @param plainPassword - The plain text password to hash
 * @returns The hashed password
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(plainPassword, saltRounds);
}

/**
 * Compare a plain text password with a hashed password
 * @param plainPassword - The plain text password
 * @param hashedPassword - The hashed password to compare against
 * @returns True if passwords match, false otherwise
 */
export async function comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return await bcrypt.compare(plainPassword, hashedPassword);
}
