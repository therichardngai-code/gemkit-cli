import readline from 'readline';

export type KeyAction =
  | 'quit'
  | 'refresh'
  | 'toggleInbox'
  | 'toggleDocs'
  | 'openWeb'
  | 'scrollUp'
  | 'scrollDown'
  | 'selectAgent';

export interface KeyboardHandlerOptions {
  onAction: (action: KeyAction, data?: string) => void;
}

export class KeyboardHandler {
  private options: KeyboardHandlerOptions;

  constructor(options: KeyboardHandlerOptions) {
    this.options = options;
  }

  /**
   * Start listening for keyboard input
   */
  start(): void {
    if (!process.stdin.isTTY) return;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on('keypress', (str, key) => {
      this.handleKeypress(str, key);
    });
  }

  /**
   * Stop listening
   */
  stop(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  /**
   * Handle keypress events
   */
  private handleKeypress(str: string | undefined, key: readline.Key): void {
    // Ctrl+C - quit
    if (key.ctrl && key.name === 'c') {
      this.options.onAction('quit');
      return;
    }

    // Letter keys
    const keyName = key.name?.toLowerCase() || str?.toLowerCase();

    switch (keyName) {
      case 'q':
        this.options.onAction('quit');
        break;
      case 'r':
        this.options.onAction('refresh');
        break;
      case 'i':
        this.options.onAction('toggleInbox');
        break;
      case 'd':
        this.options.onAction('toggleDocs');
        break;
      case 'w':
        this.options.onAction('openWeb');
        break;
      case 'up':
        this.options.onAction('scrollUp');
        break;
      case 'down':
        this.options.onAction('scrollDown');
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        this.options.onAction('selectAgent', keyName);
        break;
      case 'escape':
        // Close any open panels
        this.options.onAction('toggleInbox'); // Close inbox if open
        this.options.onAction('toggleDocs');  // Close docs if open
        break;
    }
  }
}
