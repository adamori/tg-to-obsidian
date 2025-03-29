import path from 'path';
import fs from 'fs/promises';
import {bot} from '../bot/telegramHandler'; // Need bot instance for downloads/notifications
import {logger} from '../utils/logger';
import {generateNoteMetadata} from '../ai/openAIService';
import {saveAsset, saveNote} from '../obsidian/vaultService';
import {commitAndPush} from '../git/gitService';
import {QueueTask} from './taskTypes';
import {config} from '../config';

async function downloadMedia(mediaInfo: QueueTask['media']): Promise<{ buffer: Buffer, filename: string, base64: string } | null> {
    if (!mediaInfo) return null;

    logger.info(`Downloading media: fileId=${mediaInfo.fileId}, filename=${mediaInfo.fileName}`);
    try {
        // Get file path from Telegram
        const fileLink = await bot.getFileLink(mediaInfo.fileId);

        // Download the file using fetch (or axios, request etc.)
        const response = await fetch(fileLink);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const format = mediaInfo.fileName.split('.').pop();

        logger.info(`Successfully downloaded media: ${mediaInfo.fileName}, size: ${buffer.length} bytes`);
        return {buffer, filename: mediaInfo.fileName, base64};
    } catch (error: any) {
        logger.error(`Failed to download media fileId ${mediaInfo.fileId}:`, error);
        // Decide if we should notify user here or let the main error handler do it
        throw new Error(`Failed to download media: ${error.message}`); // Re-throw to be caught by main processor
    }
}

export async function processMessageTask(task: QueueTask): Promise<void> {
    let aiMetadata: { title: string; hashtags: string[] } | null = null;
    let savedAssetPath: string | null = null; // Relative path within vault
    let noteContent = task.text || ''; // Start with text/caption
    let finalNotePath: string | null = null; // Full path to the saved note
    const assetPathsToCommit: string[] = []; // Keep track of assets saved in this task

    try {
        // 1. Download Media (if applicable)
        const downloadedMedia = await downloadMedia(task.media);

        // 2. Save Asset (if applicable)
        if (downloadedMedia) {
            savedAssetPath = await saveAsset(downloadedMedia.buffer, downloadedMedia.filename);
            assetPathsToCommit.push(path.join(config.OBSIDIAN_VAULT_PATH, savedAssetPath)); // Store full path for git add

            // Append link to note content (Obsidian Wikilink format)
            // Assuming assets are saved in a root 'assets' folder
            noteContent += `\n\n![[${savedAssetPath.replace(/\\/g, '/')}]]`; // Use forward slashes for links
        }

        // 3. Get Metadata from AI
        // Use only text content for AI analysis to keep prompts cleaner
        const textForAI = task.text || `Media: ${task.media?.fileName || 'attached file'}`;
        // noinspection PointlessBooleanExpressionJS
        if (false && !(task.text || '').trim()) {
            // noinspection JSUnreachableCode
            logger.warn(`Skipping AI analysis for messageId ${task.messageId} due to empty content.`);
            aiMetadata = {
                title: `Note from ${new Date(task.messageDate * 1000).toISOString()}`,
                hashtags: ['#uncategorized', "#no-text"]
            };
        } else {
            try {
                aiMetadata = await generateNoteMetadata(textForAI, downloadedMedia ? [downloadedMedia.base64] : undefined);
            } catch (aiError: any) {
                logger.error(`AI processing failed for messageId ${task.messageId}: ${aiError.message}`, {stack: aiError.stack});
                aiMetadata = {
                    title: `Uncategorized Note - ${task.messageId}`,
                    hashtags: ['#uncategorized', '#ai-error']
                };
                // Notify user about AI failure
                bot.sendMessage(task.chatId, `⚠️ Failed to get AI categorization for message ${task.messageId}. Saved as uncategorized.`);
            }
        }


        // 4. Format Note Content (Append metadata)
        const metadataBlock = formatMetadata(task, aiMetadata.hashtags);
        noteContent += `\n\n---\n${metadataBlock}`; // Use --- separator

        // 5. Save Note to Vault (Handles unique filename)
        finalNotePath = await saveNote(aiMetadata.title, noteContent);
        if (!finalNotePath) { // Should not happen if saveNote is implemented correctly, but check
            throw new Error('Failed to save note, path was nullish.');
        }
        logger.info(`Note saved locally: ${finalNotePath}`);


        // 6. Commit and Push to Git
        const commitMessage = `Add note: ${aiMetadata.title.substring(0, 50)}${aiMetadata.title.length > 50 ? '...' : ''}`;
        const filesToCommit = [finalNotePath, ...assetPathsToCommit];
        await commitAndPush(filesToCommit, commitMessage);
        logger.info(`Successfully committed and pushed changes for note: ${aiMetadata.title}`);

        // Optional: Notify user on success
        // bot.sendMessage(task.chatId, `✅ Note "${aiMetadata.title}" saved successfully!`);

    } catch (error: any) {
        logger.error(`Failed processing task for messageId ${task.messageId}: ${error.message}`, {stack: error.stack});

        // Notify user about the overall failure
        bot.sendMessage(task.chatId, `❌ Failed to save note from message ${task.messageId}. Error: ${error.message.substring(0, 100)}...`);

        // If note was saved locally but Git failed, it will be picked up later.
        // If asset save failed, note might be incomplete.
        // If AI failed, it's handled above.
        // If download failed, task might stop early.
        // Re-throw the error to let the queue know the task failed.
        throw error;
    }
}

function formatMetadata(task: QueueTask, hashtags: string[]): string {
    const lines: string[] = [];
    const savedDate = new Date().toLocaleString('en-US', {timeZone: 'UTC'});
    lines.push(`Saved At: ${savedDate}`);
    if (task.userId) {
        task.username ?
            lines.push(`From User: @${task.username} (ID: ${task.userId})`) :
            lines.push(`From User: ${task.userId}`);
    }
    const originalPostDate = new Date(task.messageDate * 1000).toLocaleString('en-US', {timeZone: 'UTC'});
    lines.push(`Original Date: ${originalPostDate}`);
    if (task.forwardSourceLink) {
        lines.push(`Source: ${task.forwardSourceLink}`);
    }
    if (hashtags.length > 0) {
        lines.push(`Tags: ${hashtags.join(' ')}`);
    }

    return lines.join('\n');
}