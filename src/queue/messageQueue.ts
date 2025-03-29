import async, { QueueObject } from 'async';
import { logger } from '../utils/logger';
import { processMessageTask } from './taskProcessor'; // We'll create this next
import { QueueTask } from './taskTypes';

// Create a queue object with concurrency 1 (process tasks one by one)
const taskQueue: QueueObject<QueueTask> = async.queue(
    async (task: QueueTask, callback) => {
        logger.info(`Processing task for messageId: ${task.messageId} from chatId: ${task.chatId}`);
        try {
            await processMessageTask(task);
            logger.info(`Successfully processed task for messageId: ${task.messageId}`);
            callback(); // Signal task completion
        } catch (error: any) {
            logger.error(`Error processing task for messageId: ${task.messageId}`, {
                error: error.message,
                stack: error.stack,
                task: { ...task, media: task.media ? { ...task.media, fileId: 'REDACTED' } : undefined } // Avoid logging full fileId if sensitive
            });
            // Optionally notify user about the failure here or within processMessageTask
            callback(error); // Signal task error
        }
    },
    1 // Concurrency level
);

// Assign an error handler for the queue itself (e.g., if the worker function throws synchronously)
taskQueue.error((err: Error, task: QueueTask) => {
    logger.error(`Fatal error in queue processing task for messageId ${task.messageId}:`, {
        error: err.message,
        stack: err.stack,
    });
    // Depending on the error, might need more specific handling or notifications
});

// Optional: Handle queue drain event
taskQueue.drain(() => {
    logger.info('Message queue is empty and processing has finished.');
});

export function enqueueTask(task: QueueTask): void {
    if (!task.text && !task.media) {
        logger.warn(`Skipping task for messageId ${task.messageId} as it has no text or media.`);
        return;
    }
    logger.info(`Adding task to queue for messageId: ${task.messageId}`);
    taskQueue.push(task, (err) => {
        if (err) {
            // Error handling is already done in the worker and queue.error
            // This callback in push is mostly for knowing when the specific task *finished*
            logger.debug(`Finished processing (with or without error) for messageId: ${task.messageId}`);
        }
    });
    logger.info(`Queue length: ${taskQueue.length()}`);
}

export function getQueueLength(): number {
    return taskQueue.length();
}