const express = require('express');
const { getPrismaClient } = require('../config/database');

const router = express.Router();

// GET /api/chat/conversations - List all conversations for the current user

/**
 * Get all conversations for the current user
 * GET /api/chat/conversations
 */
router.get('/conversations', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user?.id || req.query.userId;

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            userId: userId
          }
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profileImageUrl: true,
                isVerified: true,
                showOnlineStatus: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc'
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          }
        },
        _count: {
          select: {
            messages: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    res.json({
      success: true,
      conversations: conversations.map(conv => ({
        id: conv.id,
        name: conv.name,
        type: conv.type,
        isGroup: conv.isGroup,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        participants: conv.participants.map(p => ({
          id: p.userId,
          username: p.user.username,
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          profileImageUrl: p.user.profileImageUrl,
          isVerified: p.user.isVerified,
          role: p.role,
          joinedAt: p.joinedAt
        })),
  lastMessage: conv.messages[0] ? Object.assign({}, conv.messages[0], { author: conv.messages[0].sender }) : null,
        messageCount: conv._count.messages
      }))
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations',
      message: 'An error occurred while fetching conversations'
    });
  }
});

/**
 * Create a new conversation
 * POST /api/chat/conversations
 */
router.post('/conversations', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user?.id || req.body.creatorId;
    const { name, type = 'DIRECT', participantIds, isGroup = false } = req.body;

    // Validate input
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid participants',
        message: 'At least one participant is required'
      });
    }

    // For direct messages, ensure only 2 participants
    if (type === 'DIRECT' && participantIds.length > 1) {
      return res.status(400).json({
        success: false,
        error: 'Too many participants',
        message: 'Direct messages can only have 2 participants'
      });
    }

    // Check if direct conversation already exists
    if (type === 'DIRECT') {
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          isGroup: false,
          participants: {
            every: {
              userId: {
                in: [userId, participantIds[0]]
              }
            }
          }
        }
      });

      if (existingConversation) {
        return res.status(409).json({
          success: false,
          error: 'Conversation exists',
          message: 'Direct conversation already exists with this user',
          conversationId: existingConversation.id
        });
      }
    }

    // Create conversation
    const conversation = await prisma.conversation.create({
      data: {
        name: name || null,
        type: type,
        isGroup: isGroup,
        participants: {
          create: [
            {
              userId: userId,
              role: 'ADMIN'
            },
            ...participantIds.map(id => ({
              userId: id,
              role: 'MEMBER'
            }))
          ]
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profileImageUrl: true,
                isVerified: true
              }
            }
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      conversation: {
        id: conversation.id,
        name: conversation.name,
        type: conversation.type,
        isGroup: conversation.isGroup,
        createdAt: conversation.createdAt,
        participants: conversation.participants.map(p => ({
          id: p.userId,
          username: p.user.username,
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          profileImageUrl: p.user.profileImageUrl,
          isVerified: p.user.isVerified,
          role: p.role,
          joinedAt: p.joinedAt
        }))
      }
    });

  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create conversation',
      message: 'An error occurred while creating the conversation'
    });
  }
});

/**
 * Get messages for a conversation
 * GET /api/chat/conversations/:conversationId/messages
 */
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user?.id || req.query.userId;
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Check if user is participant in conversation
    const participation = await prisma.conversationUser.findFirst({
      where: {
        conversationId: conversationId,
        userId: userId
      }
    });

    if (!participation) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You are not a participant in this conversation'
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId
      },
      include: {
          sender: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
              isVerified: true
            }
          },
        attachments: true,
        readReceipts: {
          where: {
            userId: userId
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json({
      success: true,
      messages: messages.map(msg => ({
        id: msg.id,
        content: msg.content,
        type: msg.type,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        author: msg.sender,
        attachments: msg.attachments,
        isRead: msg.readReceipts.length > 0
      }))
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
      message: 'An error occurred while fetching messages'
    });
  }
});

/**
 * Send a message to a conversation
 * POST /api/chat/conversations/:conversationId/messages
 */
router.post('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user?.id || req.body.senderId;
    const { conversationId } = req.params;
    const { content, type = 'TEXT' } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Empty message',
        message: 'Message content cannot be empty'
      });
    }

    // Check if user is participant in conversation
    const participation = await prisma.conversationUser.findFirst({
      where: {
        conversationId: conversationId,
        userId: userId
      }
    });

    if (!participation) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You are not a participant in this conversation'
      });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        type: type,
        senderId: userId,
        conversationId: conversationId
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
            isVerified: true
          }
        }
      }
    });

    // Update conversation's last activity
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
        data: {
        id: message.id,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt,
        author: message.sender,
        conversationId: conversationId
      }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      message: 'An error occurred while sending the message'
    });
  }
});

/**
 * Search for users to start conversations with
 * GET /api/chat/users/search
 */
router.get('/users/search', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Invalid search query',
        message: 'Search query must be at least 2 characters long'
      });
    }

    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { username: { contains: q.trim(), mode: 'insensitive' } },
              { firstName: { contains: q.trim(), mode: 'insensitive' } },
              { lastName: { contains: q.trim(), mode: 'insensitive' } }
            ]
          },
          { allowDirectMessages: true },
          { id: { not: req.user?.id || req.query.currentUserId } } // Exclude current user
        ]
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        isVerified: true,
        collegeName: true,
        showOnlineStatus: true
      },
      take: parseInt(limit)
    });

    res.json({
      success: true,
      users: users
    });

  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: 'An error occurred while searching for users'
    });
  }
});

module.exports = router;
