import winston from 'winston';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5 * 1024 * 1024,  // 5 MB max per file — prevents unbounded disk/memory growth
    maxFiles: 2,                // keep at most 2 rotated files
  }),
  new winston.transports.File({
    filename: 'logs/all.log',
    maxsize: 10 * 1024 * 1024, // 10 MB max per file
    maxFiles: 2,
  }),
];

const logger = winston.createLogger({
  // Production uses 'warn' to avoid flooding all.log with info/debug lines.
  // Set LOG_LEVEL in .env to override (e.g. LOG_LEVEL=debug for local dev).
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
  levels,
  format,
  transports,
});

export default logger;
