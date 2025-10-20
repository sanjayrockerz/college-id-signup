const express = require('express');
const { getPrismaClient } = require('../config/database');

const router = express.Router();

// GET /api/conversations - Get all conversations for the current user

/**
 * GET / - Get all conversations for current user
 * Include last message and unread count, order by updatedAt desc
 */
router.get('/', async (req, res) => {
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
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    // Calculate unread count for each conversation
    const conversationsWithUnreadCount = await Promise.all(
      conversations.map(async (conversation) => {
        // Get unread messages count
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: {
              not: userId
            },
            readReceipts: {
              none: {
                userId: userId
              }
            }
          }
        });

        return {
          id: conversation.id,
          name: conversation.name,
          type: conversation.type,
          isGroup: conversation.isGroup,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          participants: conversation.participants.map(p => ({
            id: p.userId,
            username: p.user.username,
            firstName: p.user.firstName,
            lastName: p.user.lastName,
            profileImageUrl: p.user.profileImageUrl,
            isVerified: p.user.isVerified,
            role: p.role,
            joinedAt: p.joinedAt
          })),
          lastMessage: conversation.messages[0] ? Object.assign({}, conversation.messages[0], { author: conversation.messages[0].sender }) : null,
          unreadCount: unreadCount
        };
      })
    );

    res.json({
      success: true,
      conversations: conversationsWithUnreadCount
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
 * GET /:id/messages - Get paginated messages for a conversation
 * Validate user is member, order by createdAt desc
 */
router.get('/:id/messages', async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user?.id || req.query.userId;
    const conversationId = req.params.id;
    const { page = 1, limit = 50 } = req.query;

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const offset = (pageNumber - 1) * limitNumber;

    // Validate user is member of the conversation
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
        message: 'You are not a member of this conversation'
      });
    }

    // Get paginated messages ordered by createdAt desc (newest first)
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
        attachments: {
          select: {
            id: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            fileUrl: true
          }
        },
        readReceipts: {
          where: { userId: userId },
          select: { readAt: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limitNumber,
      skip: offset
    });

    // Get total count for pagination
    const totalMessages = await prisma.message.count({
      where: {
        conversationId: conversationId
      }
    });

    const totalPages = Math.ceil(totalMessages / limitNumber);
    const hasNextPage = pageNumber < totalPages;
    const hasPreviousPage = pageNumber > 1;

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
      })),
      pagination: {
        currentPage: pageNumber,
        totalPages: totalPages,
        totalMessages: totalMessages,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
        limit: limitNumber
      }
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
 * POST / - Create new conversation (DM or group)
 * Add participants to the conversation
 */
router.post('/', async (req, res) => {
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

    // For direct messages, ensure only 2 participants total (current user + 1 other)
    if (type === 'DIRECT' && participantIds.length > 1) {
      return res.status(400).json({
        success: false,
        error: 'Too many participants',
        message: 'Direct messages can only have 2 participants'
      });
    }

    // Validate that all participant IDs exist and are valid users
    const validParticipants = await prisma.user.findMany({
      where: {
        id: {
          in: participantIds
        },
        allowDirectMessages: true
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        isVerified: true
      }
    });

    if (validParticipants.length !== participantIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Invalid participants',
        message: 'Some participants are invalid or do not allow direct messages'
      });
    }

    // For direct conversations, check if one already exists
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

      if (existingConversation && existingConversation.participants.length === 2) {
        return res.status(409).json({
          success: false,
          error: 'Conversation exists',
          message: 'Direct conversation already exists with this user',
          conversation: {
            id: existingConversation.id,
            name: existingConversation.name,
            type: existingConversation.type,
            isGroup: existingConversation.isGroup,
            participants: existingConversation.participants.map(p => ({
              id: p.userId,
              username: p.user.username,
              firstName: p.user.firstName,
              lastName: p.user.lastName,
              profileImageUrl: p.user.profileImageUrl,
              isVerified: p.user.isVerified,
              role: p.role
            }))
          }
        });
      }
    }

    // Create the conversation with participants
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
        updatedAt: conversation.updatedAt,
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

module.exports = router;
