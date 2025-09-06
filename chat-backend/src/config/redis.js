const redis = require('redis');
const logger = require('../utils/logger');

let redisClient;

const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis server refused connection');
          return new Error('Redis server refused connection');
        }
        
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        
        if (options.attempt > 10) {
          logger.error('Redis max retry attempts reached');
          return undefined;
        }
        
        // Retry after this time
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Reconnecting to Redis...');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    // Don't exit process, allow app to run without Redis
    return null;
  }
};

const getRedisClient = () => {
  return redisClient;
};

// Cache helper functions
const setCache = async (key, value, ttl = 3600) => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    }
  } catch (error) {
    logger.warn('Redis set failed:', error.message);
  }
};

const getCache = async (key) => {
  try {
    if (redisClient && redisClient.isOpen) {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    }
    return null;
  } catch (error) {
    logger.warn('Redis get failed:', error.message);
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.del(key);
    }
  } catch (error) {
    logger.warn('Redis delete failed:', error.message);
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  setCache,
  getCache,
  deleteCache
};
