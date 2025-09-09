import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  NotFoundException,
  InternalServerErrorException,
  Param,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { FileService, FileStatus } from './file.service';
/**
 * Data Transfer Object for FileRecord.
 * This is a DTO to decouple the controller from the service's internal data structure.
 * It ensures that the public API contract is stable.
 */
interface FileRecordDto {
  fileKey: string;
  fileName: string;
  status: FileStatus;
  timestamp: number;
}

@Controller('sync')
export class FileController {
  private readonly logger = new Logger(FileController.name);
  constructor(private readonly fileService: FileService) {}

  /**
   * Endpoint for the Android app to get a list of pending files to download.
   * @returns An array of files in JSON format.
   */
  @Get('files')
  getFiles(): FileRecordDto[] {
    return this.fileService.getPendingFiles();
  }

  /**
   * Endpoint for the Android app to download a specific file.
   * @param res The Express response object.
   * @param fileKey The unique key of the file to download.
   */
  @Get('download/:fileKey')
  async downloadFile(@Param('fileKey') fileKey: string, @Res() res: Response) {
    const filePath = this.fileService.getFilePath(fileKey);
    if (!filePath) {
      throw new NotFoundException(`File with key "${fileKey}" not found.`);
    }

    try {
      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);

      await new Promise<void>((resolve, reject) => {
        fileStream.on('end', () => resolve());
        fileStream.on('error', (error) => {
          this.logger.error(
            `Failed to stream file ${filePath}: ${error.message}`,
          );
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error('Failed to read file from disk.');
      throw new InternalServerErrorException(
        'Failed to read file from disk.' + (error as Error).message,
      );
    }
  }

  /**
   * Endpoint for the Android app to update the status of a file after sync.
   * @param body The request body containing the file key and status.
   * @returns A status message.
   */
  @Post('status')
  async updateStatus(@Body() body: { fileKey: string; status: FileStatus }) {
    if (!body.fileKey || !body.status) {
      throw new InternalServerErrorException(
        'Invalid request body. Missing fileKey or status.',
      );
    }
    const success = await this.fileService.updateFileStatus(
      body.fileKey,
      body.status,
    );
    if (!success) {
      throw new NotFoundException(`File with key "${body.fileKey}" not found.`);
    }
    return {
      message: `Status for file ${body.fileKey} updated to ${body.status}`,
    };
  }
}
