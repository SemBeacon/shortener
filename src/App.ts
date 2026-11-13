import express from 'express';
import logger from 'winston';
import expressWinston from 'express-winston';
import 'winston-daily-rotate-file';
import chalk from 'chalk';
import { Configuration, loadConfiguration, validateConfiguration } from './models/Configuration.model.js';
import { Application } from './models/Application.model.js';
import { ShortenRequestError, generateIdentifier, validateShortenUri } from './security/uri.js';
import { createClient, RedisClientType } from 'redis';

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX = 60;

/**
 * SemBeacon URL Shortener
 */
export class App {
    config: Configuration;
    app: express.Application;
    client: RedisClientType;

    constructor() {
        // Load configuration
        this.config = loadConfiguration();

        // Initialize logger
        logger.configure({
            level: this.config.log.level,
            transports: [
                new logger.transports.Console({
                    format: logger.format.combine(
                        logger.format.colorize({ all: true }),
                        logger.format.timestamp({
                            format: 'YYYY-MM-DD HH:mm:ss',
                        }),
                        logger.format.printf((i) => `<${process.pid}> [${i.timestamp}][${i.level}] ${i.message}`),
                    ),
                }),
                new logger.transports.DailyRotateFile({
                    level: 'debug',
                    dirname: 'logs',
                    auditFile: 'logs/audit.json',
                    filename: 'logs/%DATE%.log',
                    datePattern: 'YYYY-MM-DD-HH',
                    zippedArchive: true,
                    format: logger.format.combine(
                        logger.format.timestamp({
                            format: 'YYYY-MM-DD HH:mm:ss',
                        }),
                        logger.format.printf((i) => `<${process.pid}> [${i.timestamp}][${i.level}] ${i.message}`),
                    ),
                    maxSize: '20m',
                    maxFiles: '14d',
                }),
            ],
        });

        // Validate configuration
        this.config = validateConfiguration(this.config);
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Connect to redis
            this.client = createClient({
                url: `redis://${process.env.REDIS_USER}:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
            });
            this.client.on('error', (err) => logger.error('Redis Client Error', err));
            logger.info('Connecting to Redis...');
            this.client
                .connect()
                .then(() => {
                    logger.info('Connected to Redis');

                    this.app = express();
                    this.app.use(
                        expressWinston.logger({
                            transports: [
                                new logger.transports.Console({
                                    format: logger.format.combine(
                                        logger.format.colorize({ all: true }),
                                        logger.format.timestamp({
                                            format: 'YYYY-MM-DD HH:mm:ss',
                                        }),
                                        logger.format.printf((i) => `<${process.pid}> [${i.timestamp}] ${i.message}`),
                                    ),
                                }),
                                new logger.transports.DailyRotateFile({
                                    level: 'debug',
                                    dirname: 'logs',
                                    auditFile: 'logs/audit.json',
                                    filename: 'logs/requests-%DATE%.log',
                                    datePattern: 'YYYY-MM-DD-HH',
                                    zippedArchive: true,
                                    format: logger.format.combine(
                                        logger.format.timestamp({
                                            format: 'YYYY-MM-DD HH:mm:ss',
                                        }),
                                        logger.format.printf(
                                            (i) => `<${process.pid}> [${i.timestamp}][${i.level}] ${i.message}`,
                                        ),
                                    ),
                                    maxSize: '20m',
                                    maxFiles: '14d',
                                }),
                            ],
                            level: 'info',
                            // Log the path only: the query string contains the API key and the target URI.
                            msg: () => {
                                const expressMsgFormat =
                                    chalk.gray('From {{req.ip}} - {{req.method}} {{req.path}}') +
                                    ' {{res.statusCode}} ' +
                                    chalk.gray('{{res.responseTime}}ms');
                                return expressMsgFormat;
                            },
                            ignoreRoute: function () {
                                return false;
                            },
                        }),
                    );
                    this.app.disable('etag');
                    this.app.all('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
                        // Set CORS headers
                        res.header('access-control-allow-origin', '*');
                        res.header('access-control-allow-methods', 'GET, HEAD');
                        res.header('access-control-allow-headers', 'Accept, X-Integrity-Token, X-Request-Timestamp');

                        if (req.method === 'OPTIONS') {
                            // CORS Preflight
                            res.send();
                            return;
                        }
                        return next();
                    });

                    this.app.all('/shorten/:app/', (req: express.Request, res: express.Response) => {
                        this.onShortenRequest(req, res).catch((error) => {
                            logger.error('Unhandled shortening error', error);
                            if (!res.headersSent) {
                                res.status(500).send({ error: 'Internal server error!' });
                            }
                        });
                    });
                    this.app.all('/s/:app/:id', (req: express.Request, res: express.Response) => {
                        this.onResolveRequest(req, res).catch((error) => {
                            logger.error('Unhandled resolve error', error);
                            if (!res.headersSent) {
                                res.status(500).send({ error: 'Internal server error!' });
                            }
                        });
                    });

                    this.app.set('port', this.config.port);

                    this.app.listen(this.app.get('port'), () => {
                        logger.info('Shortener server listening on port :' + this.config.port);
                        resolve();
                    });
                })
                .catch(reject);
        });
    }

    async onResolveRequest(req: express.Request, res: express.Response): Promise<void> {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.header('Allow', 'GET, HEAD');
            res.status(405).send({ error: 'Only GET and HEAD requests are supported!' });
            return;
        }
        const code = req.params.id;
        if (!code) {
            res.status(400).send({ error: 'Please provide a short code!' });
            return;
        }
        const app = this.getApplicationById(req.params.app);
        if (!app) {
            res.status(404).type('json').send({ error: 'Application identifier not found!' });
            return;
        }
        const uri = await this.resolveIdentifier(app, code);
        if (uri === null) {
            res.status(404).send({ error: 'Short code not found!' });
            return;
        }
        let target: URL;
        try {
            target = new URL(uri);
        } catch {
            res.status(404).send({ error: 'Short code not found!' });
            return;
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            res.status(404).send({ error: 'Short code not found!' });
            return;
        }
        logger.debug(`Resolved ${code} to ${target.host}`);
        res.header('Referrer-Policy', 'no-referrer');
        res.redirect(301, target.href);
    }

    async onShortenRequest(req: express.Request, res: express.Response): Promise<void> {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.header('Allow', 'GET, HEAD');
            res.status(405).send({ error: 'Only GET and HEAD requests are supported!' });
            return;
        }
        const app = this.getApplicationById(req.params.app);
        if (!app) {
            res.status(404).type('json').send({ error: 'Application identifier not found!' });
            return;
        }
        const api = req.query.api as string;
        const appByKey = this.getApplicationByKey(app, api);
        if (!appByKey) {
            res.status(401).type('json').send({ error: 'API key not found!' });
            return;
        }

        const rawUri = req.query.uri as string;
        let uri: URL;
        try {
            uri = validateShortenUri(app, rawUri);
        } catch (error) {
            this.sendError(res, error);
            return;
        }

        if (!(await this.checkRateLimit(app, req.ip))) {
            res.header('Retry-After', String(app.rateLimit?.windowSeconds ?? DEFAULT_RATE_LIMIT_WINDOW_SECONDS));
            res.status(429).send({ error: 'Too many requests!' });
            return;
        }

        // Check cache if this URL is already shortened
        let identifier = '';
        this.resolveURI(app, uri.href)
            .then((result) => {
                if (result !== null) {
                    return result;
                }
                // Legacy rows may have been stored without URL normalisation.
                return this.resolveURI(app, rawUri);
            })
            .then((result) => {
                if (result !== null) {
                    const shortUri = app.url + (app.url.endsWith('/') ? '' : '/') + result;
                    res.status(200).type('text/plain').send(shortUri);
                    return Promise.reject(undefined);
                } else {
                    return this.getUnusedIdentifier(app);
                }
            })
            .then((id) => {
                identifier = id;
                return this.setIdentifier(app, identifier, uri.href);
            })
            .then(() => {
                const shortUri = app.url + (app.url.endsWith('/') ? '' : '/') + identifier;
                logger.debug(`Shortened ${uri.host} to ${shortUri}`);
                res.status(200).type('text/plain').send(shortUri);
            })
            .catch((err) => {
                if (err) {
                    logger.error('Error shortening URL', err);
                    res.status(500).send({ error: 'Internal server error!' });
                }
            });
    }

    /**
     * Return a ShortenRequestError with its status, or a generic 500.
     * @param res Response
     * @param error Error to send
     */
    private sendError(res: express.Response, error: unknown): void {
        if (error instanceof ShortenRequestError) {
            res.status(error.status).send({ error: error.message });
            return;
        }
        logger.error('Unexpected shortener error', error);
        res.status(500).send({ error: 'Internal server error!' });
    }

    /**
     * Redis-backed rate limit shared by all cluster workers.
     * @param app Application that owns the key
     * @param ip Client IP
     */
    private async checkRateLimit(app: Application, ip: string | undefined): Promise<boolean> {
        const windowSeconds = Math.max(1, app.rateLimit?.windowSeconds ?? DEFAULT_RATE_LIMIT_WINDOW_SECONDS);
        const max = Math.max(1, app.rateLimit?.max ?? DEFAULT_RATE_LIMIT_MAX);
        const window = Math.floor(Date.now() / (windowSeconds * 1000));
        const key = `${app.id.toLowerCase()}:ratelimit:${ip ?? 'unknown'}:${window}`;
        try {
            const count = await this.client.incr(key);
            if (count === 1) {
                await this.client.expire(key, windowSeconds);
            }
            return count <= max;
        } catch (error) {
            // A cache outage must not take the shortener down.
            logger.error('Rate limit check failed, allowing request', error);
            return true;
        }
    }

    getApplicationByKey(application: Application, key: string): Application {
        return this.config.applications.find((app) => app.key === key && app.id === application.id);
    }

    getApplicationById(id: string): Application {
        return this.config.applications.find((app) => app.id === id);
    }

    setIdentifier(app: Application, identifier: string, uri: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client
                .set(`${app.id.toLowerCase()}:short:${identifier}`, uri)
                .then(() => {
                    return this.client.set(`${app.id.toLowerCase()}:uri:${uri}`, identifier);
                })
                .then(() => {
                    resolve();
                })
                .catch(reject);
        });
    }

    resolveURI(app: Application, uri: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.client
                .get(`${app.id.toLowerCase()}:uri:${uri}`)
                .then((result) => {
                    resolve(result);
                })
                .catch(reject);
        });
    }

    resolveIdentifier(app: Application, identifier: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.client
                .get(`${app.id.toLowerCase()}:short:${identifier}`)
                .then((result) => {
                    resolve(result);
                })
                .catch(reject);
        });
    }

    getUnusedIdentifier(app: Application): Promise<string> {
        return new Promise((resolve, reject) => {
            const identifier = generateIdentifier(app.characters, app.maxLength);
            // If it is, try again
            this.resolveIdentifier(app, identifier)
                .then((result) => {
                    if (result !== null) {
                        return this.getUnusedIdentifier(app);
                    }
                    return Promise.resolve(identifier);
                })
                .then((identifier) => {
                    resolve(identifier);
                })
                .catch(reject);
        });
    }
}
