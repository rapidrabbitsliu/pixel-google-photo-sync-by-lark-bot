import * as Lark from '@larksuiteoapi/node-sdk';
// To use .env files with ES Modules, you need to install the 'dotenv' package: npm install dotenv
// Then, add "type": "module" to your package.json file.
// The dotenv package is now imported with the following syntax.
import 'dotenv/config';

const baseConfig = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
};

const client = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({ ...baseConfig, loggerLevel: Lark.LoggerLevel.debug });

// A Set to store event IDs that have been processed to prevent duplicate replies.
// The data will be automatically garbage collected to prevent memory bloat.
// The key is the event ID, and the value is a timestamp.
const processedEvents = new Set();
const EVENT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

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

wsClient.start({
  // Handle the 'receive message' event, event type is im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const {
        message: {
          chat_id,
          content
        },
        event_id
      } = data;

      // Check if the event has already been processed using the unique event_id.
      if (isEventProcessed(event_id)) {
        console.log(`Ignoring duplicate event: ${event_id}`);
        return; // Exit the function to prevent duplicate replies.
      }

      // Example operation: After receiving a message, call the 'send message' API to reply.
      console.log(`Received new event: ${event_id}`);
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id"
        },
        data: {
          receive_id: chat_id,
          content: Lark.messageCard.defaultCard({
            title: `回复： ${JSON.parse(content).text}`,
            content: '新年好'
          }),
          msg_type: 'interactive'
        }
      });
    }
  })
});

console.log('Feishu WSClient started.');
