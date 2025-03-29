import express from 'express';
import bodyParser from 'body-parser';
import { config } from './config';
import { logger } from './utils/logger';
import { initializeBot, handleWebhook } from './bot/telegramHandler';
import { startPeriodicGitPull, stopPeriodicGitPull } from './git/gitService'; // Import git service functions

async function startServer() {
  logger.info('Starting server setup...');

  const app = express();

  // --- Body parser setup remains the same ---
  app.use(bodyParser.json({
      verify: (req: express.Request & { rawBody?: Buffer }, res, buf, encoding) => {
          if (config.WEBHOOK_SECRET_TOKEN) {
              const telegramSignature = req.headers['x-telegram-bot-api-secret-token'] as string;
              if (telegramSignature !== config.WEBHOOK_SECRET_TOKEN) {
                  logger.warn('Invalid webhook secret token received');
                  throw new Error('Invalid webhook secret token');
              }
          }
          // if (config.ALLOWED_USER_IDS.length > 0) {
          //     const userId = req.body.update?.message?.from?.id;
          //     if (!userId || !config.ALLOWED_USER_IDS.includes(userId.toString())) {
          //         logger.warn(`Unauthorized user tried to access: ${userId}. Message: ${req.body.message?.text}`);
          //         console.log(req.body);
          //         throw new Error('Unauthorized user');
          //     }
          // }
      }
  }));

  // Initialize Telegram Bot
  try {
    await initializeBot(); // This now also attaches the message listener
    logger.info('Telegram bot initialized and webhook set.');
  } catch (error: any) {
    logger.error('Failed to initialize Telegram bot or set webhook:', { error: error.message, stack: error.stack });
    process.exit(1); // Exit if bot setup fails
  }

  // --- Webhook endpoint remains the same ---
  const webhookPath = `/webhook/${config.TELEGRAM_BOT_TOKEN}`;
  app.post(webhookPath, handleWebhook);

  // --- Health check remains the same ---
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

   // --- 404 and Global Error Handler remain the same ---
   app.use((req, res) => {
       logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
       res.status(404).send('Not Found');
   });
   app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
       logger.error('Unhandled Express error:', { message: err.message, stack: err.stack, url: req.originalUrl, method: req.method, ip: req.ip });
       res.status(500).send(process.env.NODE_ENV === 'production' ? 'Internal Server Error' : `Error: ${err.message}`);
   });


  const server = app.listen(config.PORT, () => { // Store server instance
    logger.info(`Server listening on port ${config.PORT}`);
    logger.info(`Webhook endpoint: ${webhookPath}`);
    logger.info(`Obsidian Vault Path: ${config.OBSIDIAN_VAULT_PATH}`);
    logger.info(`Ensure this server is reachable at: ${config.SERVER_URL}`);

    // Start periodic Git pull AFTER server is listening
    startPeriodicGitPull();
  });

   // Graceful Shutdown Handling
   process.on('SIGTERM', () => shutdown('SIGTERM'));
   process.on('SIGINT', () => shutdown('SIGINT')); // Catches Ctrl+C

   function shutdown(signal: string) {
       logger.warn(`Received ${signal}. Shutting down gracefully...`);
       stopPeriodicGitPull(); // Stop interval timer

       server.close((err) => {
            if (err) {
                logger.error('Error during server close:', err);
                process.exit(1);
            }
            logger.info('HTTP server closed.');
            // Optional: Add logic to wait for queue to drain or timeout
            // checkQueueAndExit();
            process.exit(0);
       });

       // Force shutdown after a timeout if server.close() hangs
       setTimeout(() => {
            logger.error('Could not close connections in time, forcing shutdown.');
            process.exit(1);
       }, 10000); // 10 seconds timeout
   }

    // Optional: Function to check queue status before exiting
    /*
    function checkQueueAndExit() {
        const queueLength = getQueueLength(); // Assuming getQueueLength is exported
        if (queueLength > 0) {
             logger.warn(`Queue still has ${queueLength} items. Waiting a bit longer...`);
             // Set another timeout or implement more robust draining logic
             setTimeout(() => {
                  logger.warn(`Exiting with ${getQueueLength()} items still in queue.`);
                  process.exit(0);
             }, 5000); // Wait 5 more seconds
        } else {
             logger.info("Queue is empty. Exiting.");
             process.exit(0);
        }
    }
    */

}

startServer().catch(error => {
    logger.error('Failed to start server:', { error: error.message, stack: error.stack });
    process.exit(1);
});