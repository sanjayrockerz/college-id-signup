import { join } from 'path';
import { useState } from 'react';
import { ProgressBar } from './ProgressBar';
import { ThumbnailPreview } from './ThumbnailPreview';
import styles from './styles/FileUpload.module.css';

const allowedMimeTypes = ['image/jpeg','image/png', 'application/pdf'];
const maxFileSize = 5 * 1024 * 1024;
export class FileUpload {
  private files: File[] = [];
  private errors: string[] = [];
  private progressBar: ProgressBar;
  private thumbnailPreview: ThumbnailPreview;

  constructor() {
    this.progressBar = new ProgressBar();
    this.thumbnailPreview = new ThumbnailPreview();
  }

  async validateFile(file: File): Promise<boolean> {
    const errors: string[] = [];

    // Check MIME type
    if (!allowedMimeTypes.includes(file.type)) {
      errors.push(`${file.name}: Invalid file type.`);
    }

    // Check file size
    if (file.size > maxFileSize) {
      errors.push(`${file.name}: File size exceeds 5MB.`);
    }

    if (errors.length > 0) {
      this.errors.push(...errors);
      return false;
    }
    return true;
  }

  async handleFiles(selectedFiles: FileList | null): Promise<void> {
    if (!selectedFiles) return;

    const validFiles: File[] = [];
    const validationErrors: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      const isValid = await this.validateFile(file);
      if (isValid) {
        validFiles.push(file);
      } else {
        validationErrors.push(`${file.name}: Validation failed.`);
      }
    }

    if (
      validFiles.length === 2 ||
      validFiles.some((file) => file.type === 'application/pdf')
    ) {
      this.files = validFiles;
      this.thumbnailPreview.renderThumbnails(validFiles);
    } else {
      validationErrors.push(
        'Please upload exactly two images or one multipage PDF.'
      );
    }

    this.errors = validationErrors;
  }

  render(): string {
    return `
      <div class="${styles.fileUploadContainer}">
        <h2>Upload Files</h2>
        <div
          class="${styles.dropZone}"
          ondragover="event.preventDefault()"
          ondrop="handleDrop(event)"
        >
          Drag and drop files here or click to upload
        </div>
        <input
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf"
          onchange="handleFilePicker(event)"
          class="${styles.fileInput}"
        />
        ${this.progressBar.render()}
        <div id="thumbnail-preview"></div>
        <div id="error-messages" class="${styles.errorMessages}"></div>
      </div>
    `;
  }
}