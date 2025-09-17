const { createServer } = require('http');
const { Server } = require('socket.io');
const { getPrismaClient } = require('./config/database');
const { socketAuthMiddleware } = require('./middleware/socketAuth');
const { registerSocketHandlers } = require('./socket/handlers');
const { app } = require('./app');

const PORT = process.env.PORT || 3000;

async function start() {
  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Apply socket auth middleware and register handlers
  io.use(socketAuthMiddleware);
  registerSocketHandlers(io);

  const httpServer = server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log('Graceful shutdown initiated');
    try {
      httpServer.close(() => console.log('HTTP server closed'));
      await io.close();
      const prisma = getPrismaClient();
      await prisma.$disconnect();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start();
}

module.exports = { start };

