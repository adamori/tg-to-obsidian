# Obsidian Telegram Bot

A Telegram bot that automatically saves messages, media, and forwarded content from Telegram to your Obsidian vault with AI-powered organization.

## What This Bot Does

This bot solves the problem of quickly capturing information from Telegram into your Obsidian knowledge base without manual effort. It captures messages and media sent to the bot, uses OpenAI to automatically generate meaningful titles and hashtags, saves content to your Obsidian vault with proper organization, and syncs with Git to keep your vault backed up and available across devices.

## Features

- **Text, Images, Videos, and Documents**: Handles various content types from Telegram
- **AI Categorization**: Automatically generates relevant titles and hashtags using OpenAI
- **Git Integration**: Automatically pulls changes and commits new notes
- **Access Control**: Restrict usage to specific Telegram users
- **Metadata Preservation**: Keeps original timestamps and forwarded message sources

## Setup Requirements

You'll need a Node.js environment, Telegram Bot Token, OpenAI API Key, Git-enabled Obsidian vault, and a publicly accessible server (or ngrok for testing).

## Getting Started

### 1. Create Your Bot and Get API Keys

1. Create a Telegram bot via BotFather (`/newbot` command) and get your bot token
2. Sign up for OpenAI and get an API key from your account dashboard
3. Ensure your Obsidian vault is set up with Git

### 2. Set Up the Server

```bash
# Clone the repository
git clone https://github.com/yourusername/obsidian-telegram-bot.git
cd obsidian-telegram-bot

# Install dependencies
npm install

# Create and configure environment variables
cp .env.example .env
nano .env  # Edit with your settings
```

### 3. Configure Your Environment

Edit the `.env` file with your settings:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
SERVER_URL=https://your-domain.com/webhook/your_bot_token_here
WEBHOOK_SECRET_TOKEN=create_a_random_string
OPENAI_API_KEY=your_openai_key_here
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
NOTES_FOLDER_NAME=saved notes
ASSETS_FOLDER_NAME=assets
GIT_PULL_INTERVAL_MS=300000
PORT=3000
ALLOWED_USER_IDS=your_telegram_id,another_user_id
```

### 4. Make Your Server Accessible

- For production: Set up a domain with HTTPS and proper port forwarding
- For testing: Use ngrok to create a temporary public URL:
  ```bash
  ngrok http 3000
  ```
  Then update your `SERVER_URL` with the ngrok URL + your bot token

### 5. Start the Bot

```bash
# Start the server
npm start
```

### 6. Test Your Bot

Send a message to your bot on Telegram. It should respond and save the content to your Obsidian vault.

## Usage

Simply send text messages, images, videos, or documents to your bot. The content will be automatically processed, categorized with AI, and saved to your Obsidian vault with appropriate metadata.