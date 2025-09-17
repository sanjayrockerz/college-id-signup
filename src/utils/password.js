// Try to use bcrypt, fall back to crypto if not available
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (error) {
  // Fallback to Node.js crypto if bcrypt is not available
  const crypto = require('crypto');
  bcrypt = {
    hash: async (password, saltRounds) => {
      return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
          if (err) reject(err);
          resolve(salt + ':' + derivedKey.toString('hex'));
        });
      });
    },
    compare: async (password, hash) => {
      return new Promise((resolve, reject) => {
        const [salt, originalHash] = hash.split(':');
        crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
          if (err) reject(err);
          resolve(originalHash === derivedKey.toString('hex'));
        });
      });
    }
  };
}

/**
 * Hash a plain text password
 * @param {string} plainPassword - The plain text password to hash
 * @returns {Promise<string>} - The hashed password
 */
async function hashPassword(plainPassword) {
  const saltRounds = 12;
  return await bcrypt.hash(plainPassword, saltRounds);
}

/**
 * Compare a plain text password with a hashed password
 * @param {string} plainPassword - The plain text password
 * @param {string} hashedPassword - The hashed password to compare against
 * @returns {Promise<boolean>} - True if passwords match, false otherwise
 */
async function comparePassword(plainPassword, hashedPassword) {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = {
  hashPassword,
  comparePassword,
};
