import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function getEnvVar(key: string, required: boolean = true): string {
    const value = process.env[key];
    if (required && (value === undefined || value === null || value === '')) {
        console.error(`FATAL ERROR: Environment variable ${key} is not set.`);
        process.exit(1);
    }
    return value || '';
}

function getEnvVarAsInt(key: string, required: boolean = true, defaultValue?: number): number {
    const value = process.env[key];
    if (value === undefined || value === null || value === '') {
        if(required && defaultValue === undefined) {
            console.error(`FATAL ERROR: Environment variable ${key} is not set and no default value provided.`);
            process.exit(1);
        }
        return defaultValue as number;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        console.error(`FATAL ERROR: Environment variable ${key} is not a valid integer.`);
        process.exit(1);
    }
    return parsed;
}

export const config = {
    TELEGRAM_BOT_TOKEN: getEnvVar('TELEGRAM_BOT_TOKEN'),
    ALLOWED_USER_IDS: getEnvVar('ALLOWED_USER_IDS').split(','),
    SERVER_URL: getEnvVar('SERVER_URL'),
    WEBHOOK_SECRET_TOKEN: getEnvVar('WEBHOOK_SECRET_TOKEN', false), // Optional
    OPENAI_API_KEY: getEnvVar('OPENAI_API_KEY'),
    OBSIDIAN_VAULT_PATH: getEnvVar('OBSIDIAN_VAULT_PATH'),
    NOTES_FOLDER_NAME: getEnvVar('NOTES_FOLDER_NAME'),
    ASSETS_FOLDER_NAME: getEnvVar('ASSETS_FOLDER_NAME'),
    GIT_PULL_INTERVAL_MS: getEnvVarAsInt('GIT_PULL_INTERVAL_MS', true, 300000), // Default 5 mins
    PORT: getEnvVarAsInt('PORT', true, 3000), // Default port 3000
    LOG_LEVEL: getEnvVar('LOG_LEVEL', false) || 'info',
};

import fs from 'fs';
if (!fs.existsSync(config.OBSIDIAN_VAULT_PATH) || !fs.statSync(config.OBSIDIAN_VAULT_PATH).isDirectory()) {
    console.error(`FATAL ERROR: Obsidian vault path not found or is not a directory: ${config.OBSIDIAN_VAULT_PATH}`);
    process.exit(1);
}

// Ensure assets and notes directories exist within the vault path
export const notesPath = path.join(config.OBSIDIAN_VAULT_PATH, config.NOTES_FOLDER_NAME);
export const assetsPath = path.join(config.OBSIDIAN_VAULT_PATH, config.ASSETS_FOLDER_NAME);

if (!fs.existsSync(notesPath)) {
    console.warn(`Notes directory does not exist, creating: ${notesPath}`);
    fs.mkdirSync(notesPath, { recursive: true });
}
if (!fs.existsSync(assetsPath)) {
    console.warn(`Assets directory does not exist, creating: ${assetsPath}`);
    fs.mkdirSync(assetsPath, { recursive: true });
}

// Validate Server URL structure slightly
if (!config.SERVER_URL.startsWith('https://') && !config.SERVER_URL.startsWith('http://')) {
    console.warn(`WARNING: SERVER_URL (${config.SERVER_URL}) does not start with http:// or https://. Webhook setup might fail.`);
}
// Ensure Server URL contains the bot token path for security
if (!config.SERVER_URL.endsWith(config.TELEGRAM_BOT_TOKEN)) {
    console.error(`FATAL ERROR: SERVER_URL must end with the bot token (e.g., https://your.domain/webhook/${config.TELEGRAM_BOT_TOKEN})`);
    process.exit(1);
}

// Basic check for OPENAI_API_KEY format (starts with sk-)
if (!config.OPENAI_API_KEY.startsWith('sk-')) {
    console.warn(`WARNING: OPENAI_API_KEY does not look like a standard OpenAI key (should start with 'sk-').`);
}