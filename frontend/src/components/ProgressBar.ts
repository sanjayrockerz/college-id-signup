export class ProgressBar {
  private progress: number = 0;

  updateProgress(progress: number): void {
    this.progress = progress;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      progressBar.textContent = `${progress}%`;
    }
  }

  render(): string {
    return `
      <div class="progress-bar-container">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
    `;
  }
}