import * as Lark from '@larksuiteoapi/node-sdk';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  exec
} from 'child_process';

const baseConfig = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
};

const client = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({ ...baseConfig,
  loggerLevel: Lark.LoggerLevel.debug
});

// A Set to store event IDs that have been processed to prevent duplicate replies.
const processedEvents = new Set();
const EVENT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const TEMP_DIR = path.join(process.cwd(), 'temp_uploads');

/**
 * Checks if an event has been processed recently.
 * @param {string} eventId The unique ID of the event.
 * @returns {boolean} True if the event has been processed, false otherwise.
 */
function isEventProcessed(eventId) {
  if (processedEvents.has(eventId)) {
    return true;
  }
  processedEvents.add(eventId);
  // Remove the event ID after a certain time to prevent memory issues.
  setTimeout(() => {
    processedEvents.delete(eventId);
  }, EVENT_EXPIRY_MS);
  return false;
}

/**
 * Executes a shell command and returns a promise.
 * @param {string} command The command to execute.
 * @returns {Promise<string>} A promise that resolves with the command output.
 */
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout || stderr);
      }
    });
  });
}

/**
 * Reads a stream and returns its content as a string.
 * @param {IncomingMessage} stream The stream to read.
 * @returns {Promise<string>} The stream content as a string.
 */
async function getResponseBody(stream) {
  return new Promise((resolve, reject) => {
    let body = '';
    stream.on('data', chunk => {
      body += chunk.toString();
    });
    stream.on('end', () => {
      resolve(body);
    });
    stream.on('error', err => {
      reject(err);
    });
  });
}

// Ensure the temporary directory exists.
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Handler for processing file messages (image, media, file).
async function processFileMessage(chat_id, message_id, fileKey, fileName, event_id, message_type) {
  const localFilePath = path.join(TEMP_DIR, fileName);
  // All pushed files will now be stored in a dedicated folder.
  const remoteDirPath = `/sdcard/DCIM/FeishuSync`;
  const remoteFilePath = `${remoteDirPath}/${fileName}`;

  // Reply to the user to confirm file reception.
  await client.im.v1.message.create({
    params: {
      receive_id_type: "chat_id"
    },
    data: {
      receive_id: chat_id,
      content: JSON.stringify({
        text: `已接收文件: ${fileName}，正在准备传输到 Pixel 2 XL...`
      }),
      msg_type: 'text'
    }
  });

  try {
    let response;
    // Use the correct SDK method based on the message type.
    const resourceType = message_type === 'image' ? 'image' : 'file';

    response = await client.im.v1.messageResource.get({
      path: {
        message_id: message_id,
        file_key: fileKey,
      },
      params: {
        type: resourceType
      },
    });

    const writeRet = await response.writeFile(localFilePath);
    console.log(`File downloaded to ${localFilePath}`);

    try {
      // First, ensure the destination directory exists on the phone.
      const mkdirCommand = `adb shell mkdir -p "${remoteDirPath}"`;
      console.log(`Executing mkdir command: ${mkdirCommand}`);
      await executeCommand(mkdirCommand);

      // ADB push command to transfer the file to the new directory.
      const adbPushCommand = `adb push "${localFilePath}" "${remoteFilePath}"`;
      console.log(`Executing command: ${adbPushCommand}`);
      const adbOutput = await executeCommand(adbPushCommand);
      console.log(`ADB push result: ${adbOutput}`);

      // Notify the user of successful transfer and new manual workflow.
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id"
        },
        data: {
          receive_id: chat_id,
          content: JSON.stringify({
            text: `文件 ${fileName} 已成功传输到 Pixel 2 XL 的新文件夹：\n\n**${remoteDirPath}**\n\n请在手机上使用文件管理器，手动进入该文件夹，批量选择照片后分享到 Google 相册，以完成同步。`
          }),
          msg_type: 'text'
        }
      });
    } catch (adbError) {
      console.error('ADB push failed:', adbError);
      // Notify the user of the error.
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id"
        },
        data: {
          receive_id: chat_id,
          content: JSON.stringify({
            text: `传输文件 ${fileName} 失败。错误信息：${adbError.message}`
          }),
          msg_type: 'text'
        }
      });
    } finally {
      // Clean up the temporary file.
      fs.unlink(localFilePath, (err) => {
        if (err) console.error(`Failed to delete temp file: ${err.message}`);
        console.log(`Cleaned up temp file: ${localFilePath}`);
      });
    }
  } catch (downloadError) {
    console.error('Download failed:', downloadError);
    // Print the response body if it exists to help with debugging.
    if (downloadError.response) {
      console.error('Response body:', await getResponseBody(downloadError.response.data));
    }
    let errorMessage = `下载文件 ${fileName} 失败。错误信息：${downloadError.message}`;

    // Check for a 404 error and provide more specific feedback.
    if (downloadError.response && downloadError.response.status === 404) {
      errorMessage = `下载文件 ${fileName} 失败：文件未找到或链接已过期。请尝试重新发送文件。`;
    }

    await client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chat_id,
        content: JSON.stringify({
          text: errorMessage
        }),
        msg_type: 'text'
      }
    });
  }
}

wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const {
        message: {
          chat_id,
          message_id,
          message_type,
          content,
        },
        event_id
      } = data;

      if (isEventProcessed(event_id)) {
        console.log(`Ignoring duplicate event: ${event_id}`);
        return;
      }

      console.log(`Received new event: ${event_id}`);

      try {
        const parsedContent = JSON.parse(content);

        if (message_type === 'image') {
          const fileKey = parsedContent.image_key;
          const fileName = parsedContent.file_name || `${fileKey}.jpg`;
          await processFileMessage(chat_id, message_id, fileKey, fileName, event_id, message_type);

        } else if (message_type === 'media') {
          const fileKey = parsedContent.file_key;
          const fileName = parsedContent.file_name || `${fileKey}.mp4`;
          await processFileMessage(chat_id, message_id, fileKey, fileName, event_id, message_type);

        } else if (message_type === 'file') {
          const fileKey = parsedContent.file_key;
          const fileName = parsedContent.file_name || fileKey;
          await processFileMessage(chat_id, message_id, fileKey, fileName, event_id, message_type);

        } else {
          // Reply for non-file messages.
          const textContent = parsedContent.text;
          await client.im.v1.message.create({
            params: {
              receive_id_type: "chat_id"
            },
            data: {
              receive_id: chat_id,
              content: JSON.stringify({
                text: `你好！请直接发送照片或视频，我会自动为你传输到 Pixel 2 XL。收到的消息内容: ${textContent}`
              }),
              msg_type: 'text'
            }
          });
        }
      } catch (e) {
        console.error('An error occurred:', e);
        await client.im.v1.message.create({
          params: {
            receive_id_type: "chat_id"
          },
          data: {
            receive_id: chat_id,
            content: JSON.stringify({
              text: `抱歉，处理您的请求时发生了意外错误：${e.message}`
            }),
            msg_type: 'text'
          }
        });
      }
    }
  })
});

console.log('Feishu WSClient started.');
