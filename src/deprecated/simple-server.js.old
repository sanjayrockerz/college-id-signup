const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// Minimal chat endpoints proxying to main routes if available
app.get('/api/chat/conversations', (req, res) => {
  res.json({ success: true, conversations: [] });
});

app.get('/', (req, res) => res.send('Quick health server for debugging.'));

const server = app.listen(PORT, HOST, () => {
  console.log(`Quick server listening on http://${HOST}:${PORT}`);
  console.log(`PID=${process.pid}`);
});

module.exports = { app, server };
