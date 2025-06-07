export function validateFile(file: Express.Multer.File): boolean {
  const allowedMimeTypes = ['image/jpeg', 'image/png'];
  const maxFileSize = 5 * 1024 * 1024; // 5MB

  // Check file type
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return false;
  }

  // Check file size
  if (file.size > maxFileSize) {
    return false;
  }

  return true;
}