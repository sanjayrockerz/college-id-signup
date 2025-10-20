const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { validateRequest } = require('../middleware/validation');
const { body, param, query } = require('express-validator');

// User Profile Routes
router.get('/profile', userController.getProfile);

router.put('/profile', [
  body('firstName').optional().isLength({ min: 1, max: 50 }).withMessage('First name 1-50 characters'),
  body('lastName').optional().isLength({ min: 1, max: 50 }).withMessage('Last name 1-50 characters'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio max 500 characters'),
  body('status').optional().isLength({ max: 100 }).withMessage('Status max 100 characters'),
  body('profileImage').optional().isURL().withMessage('Invalid profile image URL'),
  validateRequest
], userController.updateProfile);

router.put('/profile/privacy', [
  body('profileVisibility').optional().isIn(['public', 'college', 'private']),
  body('onlineStatus').optional().isIn(['visible', 'hidden']),
  body('lastSeenVisibility').optional().isIn(['everyone', 'contacts', 'nobody']),
  body('readReceiptsEnabled').optional().isBoolean(),
  body('allowDirectMessages').optional().isIn(['everyone', 'college', 'contacts']),
  validateRequest
], userController.updatePrivacySettings);

// User Search and Discovery
router.get('/search', [
  query('q').isLength({ min: 1 }).withMessage('Search query required'),
  query('type').optional().isIn(['username', 'name', 'college']),
  query('collegeId').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validateRequest
], userController.searchUsers);

router.get('/suggestions', [
  query('limit').optional().isInt({ min: 1, max: 20 }),
  validateRequest
], userController.getUserSuggestions);

// Contact Management
router.get('/contacts', [
  query('status').optional().isIn(['accepted', 'pending', 'blocked']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest
], userController.getContacts);

router.post('/contacts/request', [
  body('userId').isString().withMessage('User ID required'),
  body('message').optional().isLength({ max: 200 }).withMessage('Message max 200 characters'),
  validateRequest
], userController.sendContactRequest);

router.post('/contacts/accept', [
  body('userId').isString().withMessage('User ID required'),
  validateRequest
], userController.acceptContactRequest);

router.post('/contacts/decline', [
  body('userId').isString().withMessage('User ID required'),
  validateRequest
], userController.declineContactRequest);

router.delete('/contacts/:userId', [
  param('userId').isString().withMessage('User ID required'),
  validateRequest
], userController.removeContact);

// Block/Unblock Users
router.post('/block', [
  body('userId').isString().withMessage('User ID required'),
  body('reason').optional().isString(),
  validateRequest
], userController.blockUser);

router.post('/unblock', [
  body('userId').isString().withMessage('User ID required'),
  validateRequest
], userController.unblockUser);

router.get('/blocked', [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest
], userController.getBlockedUsers);

// User Status and Presence
router.put('/status', [
  body('status').isLength({ min: 1, max: 100 }).withMessage('Status 1-100 characters'),
  body('emoji').optional().isString(),
  body('expiresAt').optional().isISO8601().withMessage('Invalid expiration date'),
  validateRequest
], userController.setStatus);

router.put('/presence', [
  body('isOnline').isBoolean().withMessage('Online status required'),
  body('lastSeen').optional().isISO8601().withMessage('Invalid last seen date'),
  validateRequest
], userController.updatePresence);

// User Details (Public)
router.get('/:userId', [
  param('userId').isString().withMessage('User ID required'),
  validateRequest
], userController.getUserDetails);

// College Verification
router.post('/verify-college', [
  body('collegeId').isString().withMessage('College ID required'),
  body('studentId').isString().withMessage('Student ID required'),
  body('documents').optional().isArray(),
  validateRequest
], userController.verifyCollege);

router.get('/college/:collegeId/members', [
  param('collegeId').isString().withMessage('College ID required'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest
], userController.getCollegeMembers);

// Notification Settings
router.get('/notifications/settings', userController.getNotificationSettings);

router.put('/notifications/settings', [
  body('pushNotifications').optional().isBoolean(),
  body('emailNotifications').optional().isBoolean(),
  body('messageNotifications').optional().isBoolean(),
  body('mentionNotifications').optional().isBoolean(),
  body('groupNotifications').optional().isBoolean(),
  body('quietHours').optional().isObject(),
  validateRequest
], userController.updateNotificationSettings);

// Device Management
router.get('/devices', userController.getDevices);

router.post('/devices', [
  body('deviceToken').isString().withMessage('Device token required'),
  body('platform').isIn(['ios', 'android', 'web']).withMessage('Invalid platform'),
  body('deviceInfo').optional().isObject(),
  validateRequest
], userController.registerDevice);

router.delete('/devices/:deviceId', [
  param('deviceId').isString().withMessage('Device ID required'),
  validateRequest
], userController.removeDevice);

// Activity and Analytics
router.get('/activity', [
  query('days').optional().isInt({ min: 1, max: 30 }),
  validateRequest
], userController.getUserActivity);

// Export User Data (GDPR)
router.post('/export-data', userController.exportUserData);

// Delete Account
router.delete('/account', [
  body('password').isString().withMessage('Password required for account deletion'),
  body('confirmation').equals('DELETE_MY_ACCOUNT').withMessage('Confirmation required'),
  validateRequest
], userController.deleteAccount);

module.exports = router;
