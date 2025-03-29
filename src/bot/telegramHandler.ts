import TelegramBot, {Message} from 'node-telegram-bot-api';
import {config} from '../config';
import {logger} from '../utils/logger';
import {Request, Response} from 'express';
import {enqueueTask} from '../queue/messageQueue'; // Import enqueueTask
import {QueueTask, MediaInfo} from '../queue/taskTypes'; // Import task types

let bot: TelegramBot;

// --- initializeBot and handleWebhook remain the same ---
export async function initializeBot(): Promise<void> {
    logger.info('Initializing Telegram Bot...');
    bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN);

    const webhookUrl = config.SERVER_URL; // This includes the full path with token
    logger.info(`Setting webhook URL to: ${webhookUrl}`);

    try {
        const webhookOptions: TelegramBot.SetWebHookOptions = {
            url: webhookUrl,
        };
        if (config.WEBHOOK_SECRET_TOKEN) {
            webhookOptions.secret_token = config.WEBHOOK_SECRET_TOKEN;
        }

        await bot.setWebHook(webhookUrl, webhookOptions);

        const webhookInfo = await bot.getWebHookInfo();
        logger.info('Webhook Info:', webhookInfo);

        if (!webhookInfo.url) {
            throw new Error('Webhook URL was not set successfully.');
        }
        if (webhookInfo.url !== webhookUrl) {
            logger.warn(`Webhook URL reported by Telegram (${webhookInfo.url}) differs from configured URL (${webhookUrl})`);
        }

        logger.info('Webhook set successfully.');

        // Add listener for webhook errors (optional but good practice)
        bot.on('webhook_error', (error) => {
            logger.error('Telegram Webhook Error:', {code: error.name, message: error.message});
        });

        // --- Attach message listener HERE ---
        attachMessageListener();


    } catch (error: any) {
        logger.error('Failed to set webhook:', {error: error.message, stack: error.stack});
        throw error; // Re-throw to be caught by server startup
    }
}

export function handleWebhook(req: Request, res: Response): void {
    const update: TelegramBot.Update = req.body;
    logger.debug('Received update:', update); // Log the raw update in debug mode

    if (config.ALLOWED_USER_IDS) {
        const userId = update.message?.from?.id;
        if (!userId || !config.ALLOWED_USER_IDS.includes(userId.toString())) {
            logger.warn(`Unauthorized user tried to access: ${userId}. Message: ${update.message?.text}`);
            if (userId)
                bot.sendMessage(userId, `Please contact the admin (@paneelmaja) to get access.`);
            res.sendStatus(200); // Acknowledge receipt to Telegram quickly
            return;
        }
    }

    try {
        bot.processUpdate(update);
        res.sendStatus(200); // Acknowledge receipt to Telegram quickly
    } catch (error: any) {
        logger.error('Error processing update in bot instance:', {error: error.message, stack: error.stack});
        res.sendStatus(500);
    }
}

// --- Message Processing Logic ---

function attachMessageListener(): void {
    bot.on('message', (msg: Message) => {
        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        logger.info(`Received message from chat ID: ${chatId}`, {messageId: messageId, type: msg.chat.type});

        // Ignore messages from groups/channels unless configured otherwise
        if (msg.chat.type !== 'private') {
            logger.info(`Ignoring message from non-private chat: ${msg.chat.id} (${msg.chat.title || 'No Title'})`);
            // Optionally reply or handle group messages differently
            // bot.sendMessage(chatId, "Sorry, I currently only process messages in private chats.");
            return;
        }

        // --- Parse Message Content ---
        let textContent: string | undefined = msg.text || msg.caption;
        let mediaInfo: MediaInfo | undefined = undefined;
        let forwardSourceLink: string | undefined = undefined;

        // Identify Media (prioritize photo/video over document if caption exists)
        if (msg.photo) {
            // Get the largest photo
            const photo = msg.photo[msg.photo.length - 1];
            mediaInfo = {
                fileId: photo.file_id,
                fileName: `photo_${messageId}.jpg`, // Create a generic filename
                type: 'photo',
            };
        } else if (msg.video) {
            mediaInfo = {
                fileId: msg.video.file_id,
                fileName: `video_${messageId}_${msg.video.file_id}.${msg.video.mime_type?.split('/')[1] || 'mp4'}`,
                mimeType: msg.video.mime_type,
                type: 'video',
            };
        } else if (msg.document) {
            // Only treat as media if there's no text content (or maybe allowlist certain document types)
            // Avoid saving random documents unless explicitly intended.
            if (!textContent || (msg.document.mime_type?.startsWith('image/') || msg.document.mime_type?.startsWith('video/'))) {
                mediaInfo = {
                    fileId: msg.document.file_id,
                    fileName: msg.document.file_name || `document_${messageId}`,
                    mimeType: msg.document.mime_type,
                    type: 'document',
                };
            } else {
                logger.info(`Ignoring document '${msg.document.file_name}' as text content is present.`);
            }

        }

        // Check for Forwarded Message
        if (msg.forward_from_chat) {
            // Try to construct a source link (best effort)
            if (msg.forward_from_chat?.type === 'channel' && msg.forward_from_chat?.username && msg.forward_from_chat.id) {
                forwardSourceLink = `https://t.me/${msg.forward_from_chat.username}/${msg.forward_from_message_id}`;
            } else if (msg.forward_from_chat?.type === 'private') {
                const name = `${msg.forward_from_chat.first_name || ''} ${msg.forward_from_chat.last_name || ''}`.trim();
                const username = msg.forward_from_chat.username ? `@${msg.forward_from_chat.username}` : '';
                forwardSourceLink = `Forwarded from ${name} (${username || 'private chat'})`.trim();
            } else if (msg.forward_from_chat?.type === 'group') { // public group?
                forwardSourceLink = `Forwarded from group ${msg.forward_from_chat.title || msg.forward_from_chat.id}`;
            }
            // Add more cases if needed (user, private group - no link possible)
            logger.info(`Message is forwarded. Source link generated: ${forwardSourceLink || 'Not available'}`);
        }


        // --- Create Task Object ---
        const task: QueueTask = {
            chatId: chatId,
            messageId: messageId,
            text: textContent,
            media: mediaInfo,
            forwardSourceLink: forwardSourceLink,
            userId: msg.from?.id,
            username: msg.from?.username || `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim(),
            messageDate: msg.forward_date || msg.edit_date || msg.date,
        };

        // --- Enqueue Task ---
        try {
            enqueueTask(task);
            // Optional: Send immediate feedback
            // bot.sendMessage(chatId, `Got it! Adding message ${messageId} to the processing queue.`);
            // @ts-expect-error: setMessageReaction is not in the type definitions
            bot.setMessageReaction(chatId, messageId, {reaction: [{type: 'emoji', emoji: '💯'}]});
        } catch (error: any) {
            logger.error(`Failed to enqueue task for message ${messageId}: ${error.message}`, {stack: error.stack});
            bot.sendMessage(chatId, `❌ Sorry, there was an error adding your message ${messageId} to the queue.`);
        }
    });

    // Add listeners for other events if needed (e.g., 'edited_message')
    bot.on('polling_error', (error) => {
        // This shouldn't happen with webhooks, but good to have
        logger.error('Polling Error (should not occur with webhook):', error);
    });
}

// Remove webhook on exit
process.on('SIGINT', async () => {
    logger.info('Exiting... Removing webhook.');
    try {
        await bot.deleteWebHook();
        logger.info('Webhook removed.');
    } catch (error: any) {
        logger.error('Failed to remove webhook:', {error: error.message, stack: error.stack});
    }
    process.exit(0);
});

export {bot};