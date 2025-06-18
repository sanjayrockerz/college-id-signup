import { FileUpload } from './components/FileUpload';

export class App {
  private fileUpload: FileUpload;

  constructor() {
    this.fileUpload = new FileUpload();
  }

  render(): string {
    return `
      <div>
        <h1>Document Upload & Validation</h1>
        ${this.fileUpload.render()}
      </div>
    `;
  }
}