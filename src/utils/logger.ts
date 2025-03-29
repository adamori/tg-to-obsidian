import winston from 'winston';
import path from 'path';
import { config } from '../config';

const logDir = 'logs';

import fs from 'fs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const { combine, timestamp, printf, colorize, align, json } = winston.format;

const errorFilter = winston.format((info, opts) => {
    return info.level === 'error' ? info : false;
});

const infoFilter = winston.format((info, opts) => {
    return info.level === 'info' ? info : false;
});

const logger = winston.createLogger({
    level: config.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        json()
    ),
    transports: [
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                align(),
                printf((info) => `[${info.timestamp}] ${info.level}: ${info.message} ${info.stack ? '\n' + info.stack : ''}`)
            ),
            handleExceptions: true,
        }),
        // Log info level logs to a combined file
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          format: infoFilter(), // Only log info level
        }),
        // Log errors to a separate file
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error', // Log only errors
          format: errorFilter(),
          handleExceptions: true,
        }),
    ],
    exitOnError: false,
});

logger.add(new winston.transports.File({ filename: 'error.log', level: 'error' }));
logger.add(new winston.transports.File({ filename: 'combined.log' }));

logger.info('Logger initialized');

export { logger };