const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = require('./src/app');
const { initializeSocket } = require('./src/socket');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 3002;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 1e6, // 1MB limit for socket messages
  pingTimeout: 60000,
  pingInterval: 25000
});

// Initialize socket handlers
initializeSocket(io);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/college-chat')
  .then(() => {
    logger.info('Connected to MongoDB');
  })
  .catch((error) => {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  });

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  
  // Close Socket.IO connections
  io.close(() => {
    logger.info('Socket.IO server closed');
  });
  
  // Close MongoDB connection
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  logger.info(`Chat backend server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Socket.IO CORS origin: ${process.env.SOCKET_CORS_ORIGIN}`);
});

module.exports = { app, server, io };
