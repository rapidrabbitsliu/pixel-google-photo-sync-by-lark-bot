import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

// Define the file status enum and data structure
export enum FileStatus {
  Pending = 'PENDING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Expired = 'EXPIRED',
}

interface FileRecord {
  fileKey: string;
  fileName: string;
  status: FileStatus;
  timestamp: number;
}

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);
  private readonly FILE_DATA_FILE: string;
  private readonly FILE_MEDIA_DIR: string;
  private files: FileRecord[] = [];

  constructor(private readonly configService: ConfigService) {
    const fileMediaDir = this.configService.get<string>('FILE_MEDIA_DIR');
    this.FILE_MEDIA_DIR = path.join(
      process.cwd(),
      '_data',
      fileMediaDir || 'file_media',
    );

    const fileDataDir = this.configService.get<string>('FILE_DATA_DIR');
    this.FILE_DATA_FILE = path.join(
      process.cwd(),
      '_data',
      fileDataDir || 'file_data',
      'feishu_files.json',
    );
  }

  async onModuleInit() {
    await this.ensureFileDirectory();
    await this.ensureDataDirectory();
    await this.loadState();
  }

  /**
   * Ensures the local file download directory exists.
   */
  private async ensureFileDirectory() {
    try {
      await fs.mkdir(this.FILE_MEDIA_DIR, { recursive: true });
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to create file directory: ${this.FILE_MEDIA_DIR}`,
          error.stack,
        );
      } else {
        this.logger.error(
          `Failed to create file directory: ${this.FILE_MEDIA_DIR}`,
          error,
        );
      }
    }
  }

  /**
   * Ensures the data file directory exists.
   */
  private async ensureDataDirectory() {
    const dataDir = path.dirname(this.FILE_DATA_FILE);
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to create data directory: ${dataDir}`,
          error.stack,
        );
      } else {
        this.logger.error(
          `Failed to create data directory: ${dataDir}`,
          error,
        );
      }
    }
  }

  /**
   * Loads the file status from a local JSON file on service start.
   */
  private async loadState() {
    try {
      const data = await fs.readFile(this.FILE_DATA_FILE, 'utf-8');
      this.files = JSON.parse(data) as FileRecord[];
      this.logger.log(`Loaded ${this.files.length} file records from disk.`);
    } catch (error) {
      // It's expected for this to fail on first run if the file doesn't exist.
      if (error instanceof Error && (error as any).code !== 'ENOENT') {
        this.logger.error(
          `Failed to load state from ${this.FILE_DATA_FILE}: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.log('No existing state file found, starting with empty state.');
      }
    }
  }

  /**
   * Saves the current file status to a local JSON file.
   */
  private async saveState() {
    try {
      await fs.writeFile(
        this.FILE_DATA_FILE,
        JSON.stringify(this.files, null, 2),
      );
      this.logger.log('File state saved to disk.');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to save state to ${this.FILE_DATA_FILE}: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          `Failed to save state to ${this.FILE_DATA_FILE}: ${error}`,
        );
      }
    }
  }

  /**
   * Adds a new file to the service and saves it to disk.
   * @param sourceFilePath The temporary path of the file to be managed.
   * @param originalFileName The original name of the file.
   */
  async addFile(sourceFilePath: string, originalFileName: string) {
    const localFileKey = crypto.randomUUID();
    const localFileName = originalFileName || localFileKey;
    const destinationFilePath = path.join(this.FILE_MEDIA_DIR, localFileName);

    const newRecord: FileRecord = {
      fileKey: localFileKey,
      fileName: localFileName,
      status: FileStatus.Pending,
      timestamp: Date.now(),
    };

    try {
      // Move the file from its temporary location to the managed directory
      await fs.rename(sourceFilePath, destinationFilePath);
      this.logger.log(
        `File moved to managed directory: ${destinationFilePath}`,
      );

      // Add the new record to the in-memory array
      this.files.push(newRecord);
      
      // Immediately save the updated state to disk
      await this.saveState();

    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to move file to managed directory: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(`Failed to move file to managed directory: ${error}`);
      }
      // It's up to the caller to handle the failure and notify the user.
    }
  }

  /**
   * Gets a list of files that are still pending synchronization.
   * @returns An array of file records.
   */
  async getPendingFiles(): Promise<FileRecord[]> {
    await this.loadState();
    this.logger.debug('files content query', JSON.stringify(this.files))
    return this.files.filter((file) => file.status === FileStatus.Pending);
  }

  /**
   * Returns the local file path for a given file key.
   * @param fileKey The unique key of the file.
   * @returns The local file path or null if not found.
   */
  getFilePath(fileKey: string): string | null {
    const file = this.files.find((f) => f.fileKey === fileKey);
    return file ? path.join(this.FILE_MEDIA_DIR, file.fileName) : null;
  }

  /**
   * Updates the status of a file and saves the state.
   * @param fileKey The unique key of the file.
   * @param status The new status to set.
   * @returns True if the update was successful, false otherwise.
   */
  async updateFileStatus(
    fileKey: string,
    status: FileStatus,
  ): Promise<boolean> {
    const file = this.files.find((f) => f.fileKey === fileKey);
    if (file) {
      file.status = status;
      await this.saveState();

      // Clean up the local file if it has been synced or failed
      if (status === FileStatus.Completed || status === FileStatus.Failed) {
        const filePath = this.getFilePath(fileKey);
        if (filePath) {
          try {
            await fs.unlink(filePath);
            this.logger.log(`Cleaned up local file: ${filePath}`);
          } catch (error) {
            if (error instanceof Error) {
              this.logger.error(
                `Failed to delete local file: ${filePath}`,
                error.stack,
              );
            } else {
              this.logger.error(
                `Failed to delete local file: ${filePath}`,
                error,
              );
            }
          }
        }
      }
      return true;
    }
    return false;
  }
}
