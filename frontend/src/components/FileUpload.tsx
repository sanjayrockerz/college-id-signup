import React, { useState } from 'react';

const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const maxFileSize = 5 * 1024 * 1024; // 5MB
const magicNumbers: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

const FileUpload: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const validateFile = async (file: File): Promise<boolean> => {
    const errors: string[] = [];

    // Check MIME type
    if (!allowedMimeTypes.includes(file.type)) {
      errors.push(`${file.name}: Invalid file type.`);
    }

    // Check file size
    if (file.size > maxFileSize) {
      errors.push(`${file.name}: File size exceeds 5MB.`);
    }

    // Magic number detection
    const arrayBuffer = await file.slice(0, 4).arrayBuffer();
    const header = new Uint8Array(arrayBuffer);
    const expectedHeader = magicNumbers[file.type];
    if (
      expectedHeader &&
      !expectedHeader.every((byte, index) => byte === header[index])
    ) {
      errors.push(`${file.name}: File content does not match its type.`);
    }

    if (errors.length > 0) {
      setErrors((prevErrors) => [...prevErrors, ...errors]);
      return false;
    }
    return true;
  };

  const handleFiles = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const validFiles: File[] = [];
    const validationErrors: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      const isValid = await validateFile(file);
      if (isValid) {
        validFiles.push(file);
      } else {
        validationErrors.push(`${file.name}: Validation failed.`);
      }
    }

    if (validFiles.length === 2 || validFiles.some((file) => file.type === 'application/pdf')) {
      setFiles(validFiles);
    } else {
      validationErrors.push('Please upload exactly two images or one multipage PDF.');
    }

    setErrors(validationErrors);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const { files } = event.dataTransfer;
    await handleFiles(files);
  };

  const handleFilePicker = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    await handleFiles(files);
  };

  return (
    <div>
      <h2>Upload Files</h2>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: '2px dashed #007bff',
          padding: '20px',
          textAlign: 'center',
          marginBottom: '20px',
        }}
      >
        Drag and drop files here or click to upload
      </div>
      <input
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={handleFilePicker}
        style={{ display: 'block', marginBottom: '20px' }}
      />
      <ul>
        {files.map((file, index) => (
          <li key={index}>{file.name}</li>
        ))}
      </ul>
      {errors.length > 0 && (
        <div style={{ color: 'red' }}>
          <h4>Errors:</h4>
          <ul>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileUpload;