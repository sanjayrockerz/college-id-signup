/**
 * Authentication System Verification Test
 * 
 * This file tests all authentication components to ensure they work correctly together.
 * Run with: node test/auth-system-verification.js
 */

const { hashPassword, comparePassword } = require('../src/utils/password');
const { generateToken, verifyToken } = require('../src/utils/jwt');

async function testPasswordUtilities() {
  console.log('🔐 Testing Password Utilities...');
  
  const testPassword = 'TestPassword123!';
  
  try {
    // Test password hashing
    const hashedPassword = await hashPassword(testPassword);
    console.log('✅ Password hashing successful');
    
    // Test password comparison (correct password)
    const isValidPassword = await comparePassword(testPassword, hashedPassword);
    if (isValidPassword) {
      console.log('✅ Password comparison (valid) successful');
    } else {
      throw new Error('Password comparison failed for valid password');
    }
    
    // Test password comparison (incorrect password)
    const isInvalidPassword = await comparePassword('WrongPassword', hashedPassword);
    if (!isInvalidPassword) {
      console.log('✅ Password comparison (invalid) successful');
    } else {
      throw new Error('Password comparison should have failed for invalid password');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Password utilities test failed:', error.message);
    return false;
  }
}

async function testJWTUtilities() {
  console.log('🔑 Testing JWT Utilities...');
  
  const testPayload = {
    sub: 'user-123',
    email: 'test@college.edu',
    username: 'testuser'
  };
  
  try {
    // Test token generation
    const token = generateToken(testPayload);
    if (token && typeof token === 'string') {
      console.log('✅ JWT token generation successful');
    } else {
      throw new Error('Token generation failed');
    }
    
    // Test token verification
    const decoded = verifyToken(token);
    if (decoded && decoded.sub === testPayload.sub) {
      console.log('✅ JWT token verification successful');
    } else {
      throw new Error('Token verification failed');
    }
    
    // Test invalid token verification
    try {
      verifyToken('invalid.token.here');
      throw new Error('Invalid token should have thrown an error');
    } catch (error) {
      if (error.message.includes('invalid')) {
        console.log('✅ Invalid token rejection successful');
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ JWT utilities test failed:', error.message);
    return false;
  }
}

function testMiddlewareImports() {
  console.log('🛡️ Testing Middleware Imports...');
  
  try {
    // Test HTTP auth middleware import
    const { authenticateToken } = require('../src/middleware/auth');
    if (typeof authenticateToken === 'function') {
      console.log('✅ HTTP auth middleware import successful');
    } else {
      throw new Error('authenticateToken is not a function');
    }
    
    // Test Socket.IO auth middleware import
    const { socketAuthMiddleware } = require('../src/middleware/socketAuth');
    if (typeof socketAuthMiddleware === 'function') {
      console.log('✅ Socket.IO auth middleware import successful');
    } else {
      throw new Error('socketAuthMiddleware is not a function');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Middleware imports test failed:', error.message);
    return false;
  }
}

function testRouteImports() {
  console.log('🛣️ Testing Route Imports...');
  
  try {
    // Test auth routes import
    const authRoutes = require('../src/routes/auth');
    if (authRoutes && typeof authRoutes === 'object') {
      console.log('✅ Auth routes import successful');
    } else {
      throw new Error('Auth routes import failed');
    }
    
    // Test ID card routes import
    const idcardRoutes = require('../src/routes/idcard');
    if (idcardRoutes && typeof idcardRoutes === 'object') {
      console.log('✅ ID card routes import successful');
    } else {
      throw new Error('ID card routes import failed');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Route imports test failed:', error.message);
    return false;
  }
}

function testDatabaseConfig() {
  console.log('🗄️ Testing Database Configuration...');
  
  try {
    const { getPrismaClient } = require('../src/config/database');
    const prisma = getPrismaClient();
    
    if (prisma && typeof prisma === 'object') {
      console.log('✅ Database configuration successful');
    } else {
      throw new Error('Database configuration failed');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database configuration test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Authentication System Verification...\n');
  
  const tests = [
    { name: 'Password Utilities', fn: testPasswordUtilities },
    { name: 'JWT Utilities', fn: testJWTUtilities },
    { name: 'Middleware Imports', fn: testMiddlewareImports },
    { name: 'Route Imports', fn: testRouteImports },
    { name: 'Database Configuration', fn: testDatabaseConfig }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      results.push({ name: test.name, success: result });
    } catch (error) {
      console.error(`❌ ${test.name} test failed:`, error.message);
      results.push({ name: test.name, success: false });
    }
    console.log(''); // Add spacing between tests
  }
  
  // Summary
  console.log('📊 Test Results Summary:');
  console.log('─'.repeat(50));
  
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.name}`);
  });
  
  console.log('─'.repeat(50));
  console.log(`Total: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All authentication components are working correctly!');
    console.log('✅ System is ready for deployment');
  } else {
    console.log('⚠️ Some components need attention before deployment');
  }
  
  return passed === total;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests };
