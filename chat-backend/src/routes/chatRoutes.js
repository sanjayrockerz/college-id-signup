const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const messageController = require('../controllers/messageController');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { body, param, query } = require('express-validator');

// Apply authentication to all routes
router.use(authenticateToken);

// Chat Management Routes
router.post('/chats', [
  body('type').isIn(['direct', 'group', 'channel']).withMessage('Invalid chat type'),
  body('name').optional().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description max 500 characters'),
  body('participantIds').isArray({ min: 1 }).withMessage('At least one participant required'),
  body('isPublic').optional().isBoolean(),
  validateRequest
], chatController.createChat);

router.get('/chats', [
  query('type').optional().isIn(['direct', 'group', 'channel']),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest
], chatController.getUserChats);

router.get('/chats/public', [
  query('collegeId').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validateRequest
], chatController.getPublicChats);

router.get('/chats/search', [
  query('q').isLength({ min: 1 }).withMessage('Search query required'),
  query('limit').optional().isInt({ min: 1, max: 20 }),
  validateRequest
], chatController.searchChats);

router.get('/chats/:chatId', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.getChatDetails);

router.put('/chats/:chatId', [
  param('chatId').isString().withMessage('Chat ID required'),
  body('name').optional().isLength({ min: 1, max: 100 }),
  body('description').optional().isLength({ max: 500 }),
  body('settings').optional().isObject(),
  validateRequest
], chatController.updateChat);

router.delete('/chats/:chatId', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.deleteChat);

// Participant Management Routes
router.post('/chats/:chatId/participants', [
  param('chatId').isString().withMessage('Chat ID required'),
  body('userIds').isArray({ min: 1 }).withMessage('User IDs required'),
  body('role').optional().isIn(['member', 'admin']),
  validateRequest
], chatController.addParticipants);

router.delete('/chats/:chatId/participants/:userId', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('userId').isString().withMessage('User ID required'),
  validateRequest
], chatController.removeParticipant);

router.put('/chats/:chatId/participants/:userId/role', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('userId').isString().withMessage('User ID required'),
  body('role').isIn(['member', 'admin', 'owner']).withMessage('Invalid role'),
  validateRequest
], chatController.updateParticipantRole);

router.get('/chats/:chatId/participants', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.getParticipants);

// Message Routes
router.post('/chats/:chatId/messages', [
  param('chatId').isString().withMessage('Chat ID required'),
  body('content').isObject().withMessage('Content object required'),
  body('content.type').isIn(['text', 'image', 'file', 'audio', 'location']).withMessage('Invalid content type'),
  body('content.text').if(body('content.type').equals('text')).notEmpty().withMessage('Text content required'),
  body('replyTo').optional().isString(),
  validateRequest
], messageController.sendMessage);

router.get('/chats/:chatId/messages', [
  param('chatId').isString().withMessage('Chat ID required'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isString(),
  query('after').optional().isString(),
  validateRequest
], messageController.getMessages);

router.get('/chats/:chatId/messages/:messageId', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  validateRequest
], messageController.getMessage);

router.put('/chats/:chatId/messages/:messageId', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  body('content').isObject().withMessage('Content object required'),
  validateRequest
], messageController.editMessage);

router.delete('/chats/:chatId/messages/:messageId', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  validateRequest
], messageController.deleteMessage);

// Message Reactions
router.post('/chats/:chatId/messages/:messageId/reactions', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  body('emoji').isString().isLength({ min: 1, max: 10 }).withMessage('Emoji required'),
  validateRequest
], messageController.addReaction);

router.delete('/chats/:chatId/messages/:messageId/reactions/:emoji', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  param('emoji').isString().withMessage('Emoji required'),
  validateRequest
], messageController.removeReaction);

// Message Status
router.post('/chats/:chatId/messages/:messageId/read', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  validateRequest
], messageController.markAsRead);

router.post('/chats/:chatId/read-all', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], messageController.markAllAsRead);

// Pinned Messages
router.post('/chats/:chatId/messages/:messageId/pin', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  validateRequest
], chatController.pinMessage);

router.delete('/chats/:chatId/messages/:messageId/pin', [
  param('chatId').isString().withMessage('Chat ID required'),
  param('messageId').isString().withMessage('Message ID required'),
  validateRequest
], chatController.unpinMessage);

router.get('/chats/:chatId/pinned-messages', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.getPinnedMessages);

// File Upload Routes
router.post('/chats/:chatId/upload', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], messageController.uploadFile);

// Chat Archive/Unarchive
router.post('/chats/:chatId/archive', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.archiveChat);

router.post('/chats/:chatId/unarchive', [
  param('chatId').isString().withMessage('Chat ID required'),
  validateRequest
], chatController.unarchiveChat);

// Typing Indicators (WebSocket handled, but can have REST fallback)
router.post('/chats/:chatId/typing', [
  param('chatId').isString().withMessage('Chat ID required'),
  body('isTyping').isBoolean().withMessage('Typing status required'),
  validateRequest
], messageController.setTypingStatus);

module.exports = router;
