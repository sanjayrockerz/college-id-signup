const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3({
  apiVersion: '2006-03-01',
  params: {
    Bucket: process.env.AWS_BUCKET_NAME
  }
});

const uploadToS3 = async (file, folder = 'chat-files') => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${folder}/${Date.now()}-${file.originalname}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read'
    };

    const result = await s3.upload(params).promise();
    logger.info(`File uploaded to S3: ${result.Location}`);
    
    return {
      url: result.Location,
      key: result.Key,
      bucket: result.Bucket
    };
  } catch (error) {
    logger.error('S3 upload failed:', error);
    throw new Error('File upload failed');
  }
};

const deleteFromS3 = async (key) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    };

    await s3.deleteObject(params).promise();
    logger.info(`File deleted from S3: ${key}`);
  } catch (error) {
    logger.error('S3 delete failed:', error);
    throw new Error('File deletion failed');
  }
};

const generateSignedUrl = async (key, expires = 3600) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Expires: expires
    };

    const url = await s3.getSignedUrlPromise('getObject', params);
    return url;
  } catch (error) {
    logger.error('Signed URL generation failed:', error);
    throw new Error('URL generation failed');
  }
};

module.exports = {
  s3,
  uploadToS3,
  deleteFromS3,
  generateSignedUrl
};
