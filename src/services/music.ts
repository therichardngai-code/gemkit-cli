/**
 * Elevator Music Player - Cross-platform background audio for long-running processes
 * Supports: Windows (PowerShell), Mac (afplay), Linux (aplay/paplay)
 */

import { spawn, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import type { ChildProcess } from 'child_process';

// Global lock file path for cross-process coordination
const LOCK_FILE = join(tmpdir(), 'elevator-music.lock');
const LOCK_STALE_MS = 30000; // Consider lock stale after 30 seconds

interface LockData {
  pid: number;
  timestamp: number;
}

interface PlayConfig {
  command: string;
  args: string[];
  shell: boolean;
  fallback?: PlayConfig;
}

export interface ElevatorMusicOptions {
  audioFile?: string;
  loop?: boolean;
  volume?: number;
}

export class ElevatorMusic {
  private audioFile: string | null;
  private loop: boolean;
  private volume: number;
  private process: ChildProcess | null = null;
  private isPlaying: boolean = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private hasLock: boolean = false;
  private lockRefreshInterval: NodeJS.Timeout | null = null;
  private triedFallback: boolean = false;

  constructor(options: ElevatorMusicOptions = {}) {
    this.audioFile = options.audioFile || this.getDefaultAudioFile();
    this.loop = options.loop !== false; // Default to looping
    this.volume = options.volume || 0.5; // 0.0 to 1.0
  }

  /**
   * Try to acquire the global music lock
   */
  private tryAcquireLock(): boolean {
    const lockData: LockData = {
      pid: process.pid,
      timestamp: Date.now()
    };

    try {
      writeFileSync(LOCK_FILE, JSON.stringify(lockData), { flag: 'wx' });
      this.hasLock = true;

      this.lockRefreshInterval = setInterval(() => {
        this.refreshLock();
      }, LOCK_STALE_MS / 3);

      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        return this.tryTakeStaleLock(lockData);
      }
      return false;
    }
  }

  /**
   * Try to take over a potentially stale lock
   */
  private tryTakeStaleLock(newLockData: LockData): boolean {
    try {
      const existingLock: LockData = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
      const lockAge = Date.now() - existingLock.timestamp;

      if (lockAge < LOCK_STALE_MS && existingLock.pid !== process.pid) {
        try {
          process.kill(existingLock.pid, 0);
          return false;
        } catch {
          // Process doesn't exist, lock is stale
        }
      }

      unlinkSync(LOCK_FILE);

      try {
        writeFileSync(LOCK_FILE, JSON.stringify(newLockData), { flag: 'wx' });
        this.hasLock = true;

        this.lockRefreshInterval = setInterval(() => {
          this.refreshLock();
        }, LOCK_STALE_MS / 3);

        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Refresh the lock timestamp
   */
  private refreshLock(): void {
    if (!this.hasLock) return;
    try {
      const lockData: LockData = {
        pid: process.pid,
        timestamp: Date.now()
      };
      writeFileSync(LOCK_FILE, JSON.stringify(lockData), { flag: 'w' });
    } catch {
      // Ignore refresh errors
    }
  }

  /**
   * Release the global music lock
   */
  private releaseLock(): void {
    if (this.lockRefreshInterval) {
      clearInterval(this.lockRefreshInterval);
      this.lockRefreshInterval = null;
    }

    if (!this.hasLock) return;

    try {
      if (existsSync(LOCK_FILE)) {
        const lockData: LockData = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
        if (lockData.pid === process.pid) {
          unlinkSync(LOCK_FILE);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    this.hasLock = false;
  }

  /**
   * Get default audio file path
   */
  private getDefaultAudioFile(): string | null {
    // Check common locations for audio file
    const searchPaths = [
      join(process.cwd(), '.gemini', 'extensions', 'spawn-agent', 'assets', 'golden-coast-melody.wav'),
      join(process.cwd(), '.gemini', 'assets', 'elevator_music.wav'),
      join(process.cwd(), 'assets', 'elevator_music.wav'),
    ];

    for (const p of searchPaths) {
      if (existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Get platform-specific play command
   */
  private getPlayCommand(): PlayConfig | null {
    if (!this.audioFile) return null;

    const plat = platform();

    switch (plat) {
      case 'win32':
        return {
          command: 'powershell',
          args: [
            '-NoProfile',
            '-Command',
            `$player = New-Object System.Media.SoundPlayer '${this.audioFile}'; $player.PlaySync()`
          ],
          shell: false
        };

      case 'darwin':
        return {
          command: 'afplay',
          args: ['-v', String(this.volume), this.audioFile],
          shell: false
        };

      case 'linux':
        return {
          command: 'paplay',
          args: ['--volume', String(Math.round(this.volume * 65536)), this.audioFile],
          shell: false,
          fallback: {
            command: 'aplay',
            args: ['-q', this.audioFile],
            shell: false
          }
        };

      default:
        return null;
    }
  }

  /**
   * Start playing music
   */
  start(options: { force?: boolean } = {}): boolean {
    if (!this.audioFile) {
      return false;
    }

    if (!existsSync(this.audioFile)) {
      return false;
    }

    if (this.isPlaying) {
      return true;
    }

    if (!options.force && !this.tryAcquireLock()) {
      return false;
    }

    const playConfig = this.getPlayCommand();
    if (!playConfig) {
      this.releaseLock();
      return false;
    }

    this.isPlaying = true;
    this.playLoop(playConfig);
    return true;
  }

  /**
   * Internal loop handler
   */
  private playLoop(playConfig: PlayConfig): void {
    if (!this.isPlaying) return;

    const startPlay = (config: PlayConfig) => {
      this.process = spawn(config.command, config.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        shell: config.shell
      });

      this.process.stderr?.on('data', () => {
        if (config.fallback && !this.triedFallback) {
          this.triedFallback = true;
          this.process?.kill();
          startPlay(config.fallback);
        }
      });

      this.process.on('close', () => {
        if (this.isPlaying && this.loop) {
          this.loopInterval = setTimeout(() => {
            this.playLoop(playConfig);
          }, 100);
        }
      });

      this.process.on('error', () => {
        if (config.fallback && !this.triedFallback) {
          this.triedFallback = true;
          startPlay(config.fallback);
        }
      });
    };

    startPlay(playConfig);
  }

  /**
   * Stop playing music
   */
  stop(): void {
    this.isPlaying = false;

    if (this.loopInterval) {
      clearTimeout(this.loopInterval);
      this.loopInterval = null;
    }

    if (this.process) {
      if (platform() === 'win32') {
        exec(`taskkill /pid ${this.process.pid} /T /F`, { windowsHide: true });
      } else {
        this.process.kill('SIGTERM');
      }
      this.process = null;
    }

    this.releaseLock();
  }

  /**
   * Check if currently playing
   */
  get playing(): boolean {
    return this.isPlaying;
  }

  /**
   * Static method to check if any instance is currently playing
   */
  static isAnyPlaying(): boolean {
    try {
      if (!existsSync(LOCK_FILE)) {
        return false;
      }
      const lockData: LockData = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;

      if (lockAge >= LOCK_STALE_MS) {
        return false;
      }

      try {
        process.kill(lockData.pid, 0);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }
}
