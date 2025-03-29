import path from 'path';
import fs from 'fs/promises';
import { config, notesPath, assetsPath } from '../config'; // Use paths from config
import { logger } from '../utils/logger';

// Function to sanitize filenames (remove invalid chars, limit length)
function sanitizeFilename(name: string, isNote: boolean = true): string {
    // Remove invalid characters for Windows/Linux/Mac filenames
    let sanitized = name.replace(/[/\\?%*:|"<>]/g, '-');
    // Replace sequences of dashes/spaces with a single dash
    sanitized = sanitized.replace(/-+/g, '-');
    // Trim leading/trailing dashes
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    // Limit length (e.g., 100 chars) to avoid issues, leave space for numbering and extension
    sanitized = sanitized.substring(0, 100);
    // If it's a note, ensure it doesn't end with a dot (Windows issue)
    if (isNote && sanitized.endsWith('.')) {
        sanitized = sanitized.substring(0, sanitized.length - 1);
    }
    // Handle empty filename after sanitization
    if (!sanitized) {
        sanitized = `file-${Date.now()}`;
    }
    return sanitized;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Saves asset to the vault's assets folder
export async function saveAsset(fileBuffer: Buffer, originalFilename: string): Promise<string> {
    const sanitizedBase = sanitizeFilename(path.parse(originalFilename).name, false);
    const extension = path.extname(originalFilename) || '.unknown'; // Keep original extension or use default
    const timestamp = Date.now();
    const uniqueFilename = `${timestamp}-${sanitizedBase}${extension}`;
    const fullPath = path.join(assetsPath, uniqueFilename);

    try {
        logger.info(`Saving asset to: ${fullPath}`);
        await fs.writeFile(fullPath, fileBuffer);
        logger.info(`Asset saved successfully: ${uniqueFilename}`);
        // Return the relative path from the vault root for linking
        return path.join(config.ASSETS_FOLDER_NAME, uniqueFilename);
    } catch (error: any) {
        logger.error(`Failed to save asset "${uniqueFilename}" to ${assetsPath}:`, error);
        throw new Error(`Failed to write asset file: ${error.message}`);
    }
}

async function getUniqueNoteFilename(desiredTitle: string): Promise<string> {
    const sanitizedTitle = sanitizeFilename(desiredTitle, true);
    let potentialFilename = `${sanitizedTitle}.md`;
    let fullPath = path.join(notesPath, potentialFilename);
    let counter = 0;

    while (await fileExists(fullPath)) {
        counter++;
        potentialFilename = `${sanitizedTitle}-${counter}.md`;
        fullPath = path.join(notesPath, potentialFilename);
        if (counter > 100) { // Safety break
             logger.error(`Could not find unique filename for ${sanitizedTitle} after 100 attempts.`);
             throw new Error (`Failed to find unique filename for ${sanitizedTitle}`);
        }
    }
    logger.info(`Unique note filename determined: ${potentialFilename}`);
    return potentialFilename; // Return just the filename (relative to notesPath)
}

export async function saveNote(title: string, content: string): Promise<string> {
    let noteFilename: string;
    try {
        noteFilename = await getUniqueNoteFilename(title);
    } catch (error: any) {
        logger.error(`Failed to get unique filename for title "${title}", using fallback.`, error);
        // Fallback if unique name generation fails unexpectedly
        noteFilename = `fallback-note-${Date.now()}.md`;
    }

    const fullNotePath = path.join(notesPath, noteFilename);

    try {
        logger.info(`Saving note to: ${fullNotePath}`);
        await fs.writeFile(fullNotePath, content, { encoding: 'utf8' });
        logger.info(`Note "${noteFilename}" saved successfully.`);
        return fullNotePath; // Return the full path of the saved note
    } catch (error: any) {
        logger.error(`Failed to save note "${noteFilename}" to ${notesPath}:`, error);
        throw new Error(`Failed to write note file: ${error.message}`);
    }
}