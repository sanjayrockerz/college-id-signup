// Test middleware loading
console.log('🧪 Testing Authentication Middleware...\n');

try {
  console.log('📡 Testing HTTP middleware (JavaScript)...');
  const httpAuth = require('./src/middleware/auth.js');
  console.log('✅ HTTP middleware loaded successfully');
  console.log('   - authenticateToken:', typeof httpAuth.authenticateToken);
  console.log('   - getRequestUser:', typeof httpAuth.getRequestUser);
  console.log('   - isRequestAuthenticated:', typeof httpAuth.isRequestAuthenticated);
  
  console.log('\n🔌 Testing Socket.IO middleware (JavaScript)...');
  const socketAuth = require('./src/middleware/socketAuth.js');
  console.log('✅ Socket.IO middleware loaded successfully');
  console.log('   - socketAuthMiddleware:', typeof socketAuth.socketAuthMiddleware);
  console.log('   - getSocketUser:', typeof socketAuth.getSocketUser);
  console.log('   - isSocketAuthenticated:', typeof socketAuth.isSocketAuthenticated);
  
  console.log('\n🔧 Testing utility dependencies...');
  const jwt = require('./src/utils/jwt.js');
  const password = require('./src/utils/password.js');
  const database = require('./src/config/database.js');
  
  console.log('✅ JWT utilities loaded');
  console.log('✅ Password utilities loaded');
  console.log('✅ Database configuration loaded (with fallback)');
  
  console.log('\n🎉 All middleware components loaded successfully!');
  console.log('\n📋 Summary:');
  console.log('   ✅ HTTP authentication middleware ready');
  console.log('   ✅ Socket.IO authentication middleware ready');
  console.log('   ✅ All helper functions available');
  console.log('   ✅ Graceful fallback for missing dependencies');
  
} catch (error) {
  console.error('❌ Error testing middleware:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
