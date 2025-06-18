export class ThumbnailPreview {
  renderThumbnails(files: File[]): void {
    const previewContainer = document.getElementById('thumbnail-preview');
    if (previewContainer) {
      previewContainer.innerHTML = '';
      files.forEach((file) => {
        if (file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.alt = file.name;
          img.className = 'thumbnail';
          previewContainer.appendChild(img);
        } else if (file.type === 'application/pdf') {
          const pdfIcon = document.createElement('div');
          pdfIcon.textContent = 'PDF';
          pdfIcon.className = 'pdf-icon';
          previewContainer.appendChild(pdfIcon);
        }
      });
    }
  }
}