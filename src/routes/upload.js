const express = require('express');
const { S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');

const router = express.Router();

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// POST /sign-url - Generate pre-signed URL for S3 upload
router.post('/sign-url', async (req, res) => {
  try {
    const { fileName, fileType, folder } = req.body;
    
    // Input validation
    if (!fileName || !fileType) {
      return res.status(400).json({
        success: false,
        error: 'fileName and fileType are required'
      });
    }

    // Validate file type (only allow specific types)
    const allowedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(fileType)) {
      return res.status(400).json({
        success: false,
        error: 'File type not allowed'
      });
    }

    // Generate unique file key
    const fileExtension = path.extname(fileName);
    const uniqueFileName = `${crypto.randomUUID()}${fileExtension}`;
    const uploadFolder = folder || 'uploads';
    const s3Key = `${uploadFolder}/${uniqueFileName}`;

    // Create the command for the pre-signed URL
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      ContentType: fileType,
      ACL: 'public-read', // Make file publicly readable
      Metadata: {
        'uploaded-by': req.user.id.toString(),
        'original-name': fileName,
        'upload-timestamp': new Date().toISOString()
      }
    });

    // Generate pre-signed URL (expires in 1 hour)
    const preSignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    // Generate the final file URL
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;

    res.json({
      success: true,
      preSignedUrl,
      fileUrl,
      s3Key,
      expiresIn: 3600,
      uploadedBy: req.user.id
    });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate upload URL',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /config - Get upload configuration
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION || 'us-east-1',
      allowedTypes: [
        'image/jpeg',
        'image/jpg',
        'image/png', 
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ],
      maxFileSize: '10MB',
      urlExpirationTime: 3600
    }
  });
});

module.exports = router;
