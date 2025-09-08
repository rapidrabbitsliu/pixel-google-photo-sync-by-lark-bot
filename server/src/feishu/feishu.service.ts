/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  Injectable,
  Logger,
  OnModuleInit,
  // OnModuleDestroy,
} from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FeishuService implements OnModuleInit {
  private readonly logger = new Logger(FeishuService.name);
  private client: lark.Client;
  private wsClient: lark.WSClient;
  private processedEvents = new Set();
  private readonly TEMP_DIR = path.join(process.cwd(), 'temp_uploads');
  private readonly EVENT_EXPIRY_MS = 10 * 60 * 1000;

  /**
   * Ensures the temporary directory exists.
   */
  private ensureTempDirectoryExists() {
    if (!fs.existsSync(this.TEMP_DIR)) {
      fs.mkdirSync(this.TEMP_DIR);
      this.logger.log(`Created temporary directory: ${this.TEMP_DIR}`);
    }
  }

  /**
   * Cleans up the processed events Set to prevent memory leaks.
   */
  private startEventCleaner() {
    setInterval(() => {
      // In this simple implementation, the setTimeout logic in isEventProcessed is sufficient.
      this.logger.log('Running event cleaner...');
    }, this.EVENT_EXPIRY_MS);
  }

  /**
   * Starts the Feishu WebSocket client and registers event handlers.
   */
  public startWsClient() {
    this.wsClient.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          const {
            message: { chat_id, message_id, message_type, content },
            event_id,
          } = data;

          if (event_id && this.isEventProcessed(event_id)) {
            console.log(`Ignoring duplicate event: ${event_id}`);
            return;
          }

          console.log(`Received new event: ${event_id}`);

          try {
            const parsedContent: {
              image_key?: string;
              file_key?: string;
              file_name?: string;
              text?: string;
            } = JSON.parse(content);

            if (message_type === 'image') {
              const fileKey = parsedContent.image_key;
              const fileName = parsedContent.file_name || `${fileKey}.jpg`;
              if (!fileKey) {
                throw new Error('Image key is missing in the message content.');
              }

              await this.processFileMessage(
                chat_id,
                message_id,
                fileKey,
                fileName,
                'image',
              );
            } else if (message_type === 'media') {
              const fileKey = parsedContent.file_key;
              const fileName = parsedContent.file_name || `${fileKey}.mp4`;
              if (!fileKey) {
                throw new Error(
                  'Media file key is missing in the message content.',
                );
              }

              await this.processFileMessage(
                chat_id,
                message_id,
                fileKey,
                fileName,
                'file',
              );
            } else if (message_type === 'file') {
              const fileKey = parsedContent.file_key;
              if (!fileKey) {
                throw new Error('File key is missing in the message content.');
              }
              const fileName = parsedContent.file_name || fileKey;

              await this.processFileMessage(
                chat_id,
                message_id,
                fileKey,
                fileName,
                'file',
              );
            } else {
              // Reply for non-file messages.

              const textContent = parsedContent.text;

              await this.client.im.v1.message.create({
                params: {
                  receive_id_type: 'chat_id',
                },

                data: {
                  receive_id: chat_id,

                  content: JSON.stringify({
                    text: `你好！请直接发送照片或视频。收到的消息内容: ${textContent}`,
                  }),

                  msg_type: 'text',
                },
              });
            }
          } catch (e) {
            const err = e as Error;
            console.error('An error occurred:', e);

            await this.client.im.v1.message.create({
              params: {
                receive_id_type: 'chat_id',
              },

              data: {
                receive_id: chat_id,

                content: JSON.stringify({
                  text: `抱歉，处理您的请求时发生了意外错误：${err.message}`,
                }),

                msg_type: 'text',
              },
            });
          }
        },
      }),
    });
    this.logger.log('Feishu WSClient started.');
  }

  onModuleInit() {
    this.ensureTempDirectoryExists();
    this.startWsClient();
    this.startEventCleaner();
  }

  constructor(private readonly configService: ConfigService) {
    const baseConfig = {
      appId: this.configService.get('FEISHU_APP_ID') || '',
      appSecret: this.configService.get('FEISHU_APP_SECRET') || '',
    };

    if (baseConfig.appId === '' || baseConfig.appSecret === '') {
      throw new Error(
        'Feishu App ID or App Secret is not set in environment variables.',
      );
    }

    this.client = new lark.Client(baseConfig);
    this.wsClient = new lark.WSClient({
      ...baseConfig,
      loggerLevel: lark.LoggerLevel.debug,
    });
  }

  // onModuleDestroy() {
  //   this.wsClient.close();
  // }

  /**
   * Checks if an event has been processed recently.
   * @param {string} eventId The unique ID of the event.
   * @returns {boolean} True if the event has been processed, false otherwise.
   */
  private isEventProcessed(eventId: string): boolean {
    if (this.processedEvents.has(eventId)) {
      return true;
    }
    this.processedEvents.add(eventId);
    // Remove the event ID after a certain time to prevent memory issues.
    setTimeout(() => {
      this.processedEvents.delete(eventId);
    }, this.EVENT_EXPIRY_MS);
    return false;
  }

  /**
   * Processes a file message, downloads the file, and hands it off.
   */
  private async processFileMessage(
    chat_id: string,
    message_id: string,
    fileKey: string,
    fileName: string,
    resourceType: 'image' | 'file',
  ) {
    await this.replyToUser(chat_id, `已接收文件: ${fileName}，正在准备传输...`);

    try {
      const response = await this.client.im.v1.messageResource.get({
        path: {
          message_id,
          file_key: fileKey,
        },
        params: {
          type: resourceType,
        },
      });

      const localFilePath = path.join(this.TEMP_DIR, fileName);
      await response.writeFile(localFilePath);
      this.logger.log(`File downloaded to ${localFilePath}`);

      await this.replyToUser(chat_id, `文件 ${fileName} 已成功下载到服务端。`);
    } catch (downloadError) {
      const err = downloadError as {
        message: string;
        response?: { status: number };
      };
      this.logger.error(
        `Download failed: ${err.message}`,
        (downloadError as Error).stack,
      );
      let errorMessage = `下载文件 ${fileName} 失败。错误信息：${err.message}`;

      if (err.response && err.response.status === 404) {
        errorMessage = `下载文件 ${fileName} 失败：文件未找到或链接已过期。请尝试重新发送文件。`;
      }
      await this.replyToUser(chat_id, errorMessage);
    }
  }

  /**
   * Helper to reply to a user in a chat.
   */
  public async replyToUser(chat_id: string, text: string) {
    try {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chat_id,
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      });
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Failed to reply to user: ${err.message}`);
    }
  }
}
