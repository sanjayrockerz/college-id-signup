const request = require('supertest');
const { app } = require('../src/app');
const { getPrismaClient } = require('../src/config/database');

describe('Authentication System Integration Tests', () => {
  let prisma;
  let authToken;
  let testUser;

  beforeAll(async () => {
    prisma = getPrismaClient();
    
    // Clean up any existing test data
    await prisma.idCardVerification.deleteMany({
      where: {
        user: {
          email: 'test@college.edu'
        }
      }
    });
    
    await prisma.user.deleteMany({
      where: {
        email: 'test@college.edu'
      }
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (testUser) {
      await prisma.idCardVerification.deleteMany({
        where: {
          userId: testUser.id
        }
      });
      
      await prisma.user.delete({
        where: {
          id: testUser.id
        }
      });
    }
    
    await prisma.$disconnect();
  });

  describe('Health Endpoints', () => {
    test('GET /health should return server status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });

    test('GET /health/database should return database status', async () => {
      const response = await request(app)
        .get('/health/database')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('database', 'Connected');
    });
  });

  describe('User Registration', () => {
    test('POST /api/auth/register should create a new user', async () => {
      const userData = {
        email: 'test@college.edu',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User',
        studentId: 'TEST12345',
        phoneNumber: '+1234567890'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', userData.email);
      expect(response.body.user).not.toHaveProperty('password');

      testUser = response.body.user;
    });

    test('POST /api/auth/register should reject duplicate email', async () => {
      const userData = {
        email: 'test@college.edu',
        password: 'TestPassword123!',
        firstName: 'Duplicate',
        lastName: 'User',
        studentId: 'DUP12345',
        phoneNumber: '+1234567891'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
    });

    test('POST /api/auth/register should validate required fields', async () => {
      const incompleteData = {
        email: 'incomplete@college.edu',
        password: 'weak'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(incompleteData)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('User Authentication', () => {
    test('POST /api/auth/login should authenticate valid user', async () => {
      const loginData = {
        email: 'test@college.edu',
        password: 'TestPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', loginData.email);

      authToken = response.body.token;
    });

    test('POST /api/auth/login should reject invalid credentials', async () => {
      const invalidLogin = {
        email: 'test@college.edu',
        password: 'WrongPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(invalidLogin)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });

    test('POST /api/auth/login should reject non-existent user', async () => {
      const nonExistentLogin = {
        email: 'nonexistent@college.edu',
        password: 'TestPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(nonExistentLogin)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('Protected Routes', () => {
    test('GET /api/auth/me should return user profile with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', 'test@college.edu');
      expect(response.body.user).not.toHaveProperty('password');
    });

    test('GET /api/auth/me should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });

    test('GET /api/auth/me should reject missing token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('User Profile Management', () => {
    test('PUT /api/auth/profile should update user profile', async () => {
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        phoneNumber: '+1987654321'
      };

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('firstName', updateData.firstName);
      expect(response.body.user).toHaveProperty('lastName', updateData.lastName);
    });

    test('PUT /api/auth/password should change password', async () => {
      const passwordData = {
        currentPassword: 'TestPassword123!',
        newPassword: 'NewTestPassword123!'
      };

      const response = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send(passwordData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');

      // Test that login works with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@college.edu',
          password: passwordData.newPassword
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('success', true);
      authToken = loginResponse.body.token;
    });
  });

  describe('Error Handling', () => {
    test('Should handle 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/api/non-existent-route')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Not Found');
    });

    test('Should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('API Documentation', () => {
    test('GET / should return API documentation', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'College ID Signup API');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
    });
  });
});
