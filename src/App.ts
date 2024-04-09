import * as express from 'express';
import * as logger from 'winston';
import * as expressWinston from 'express-winston';
import 'winston-daily-rotate-file';
import * as chalk from 'chalk';
import { Configuration } from './models/Configuration';
import * as path from 'path';
import { Application } from './models/Application';
import { createClient, RedisClientType } from 'redis';

export class App {
    config: Configuration;
    app: express.Application;
    logger: logger.Logger;
    client: RedisClientType;

    constructor() {
        // Load configuration
        this.config = require(path.resolve('./config.json'));

        // Initialize logger
        this.logger = logger.createLogger({
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
                    maxFiles: '14d'
                })
            ],
        });
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Connect to redis
            this.client = createClient({
                url: `redis://${process.env.REDIS_USER}:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
            });
            this.client.on('error', err => this.logger.error('Redis Client Error', err));
            this.logger.info('Connecting to Redis...');
            this.client.connect().then(() => {
                this.logger.info('Connected to Redis');

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
                                    logger.format.printf((i) => `<${process.pid}> [${i.timestamp}][${i.level}] ${i.message}`),
                                ),
                                maxSize: '20m',
                                maxFiles: '14d'
                            })
                        ],
                        level: 'info',
                        msg: () => {
                            const expressMsgFormat =
                                chalk.gray('From {{req.ip}} - {{req.method}} {{req.url}}') +
                                ' {{res.statusCode}} ' +
                                chalk.gray('{{res.responseTime}}ms');
                            return expressMsgFormat;
                        },
                        ignoreRoute: function (req, res) {
                            return false;
                        },
                    }),
                );
                this.app.disable('etag');
                this.app.all('/', (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    // Set CORS headers
                    res.header('access-control-allow-private-network', 'true');
                    res.header('access-control-allow-origin', '*');
                    res.header('access-control-allow-methods', 'GET, PUT, PATCH, POST, DELETE');
                    res.header('access-control-allow-headers', req.header('access-control-request-headers'));
    
                    if (req.method === 'OPTIONS') {
                        // CORS Preflight
                        res.send();
                        return;
                    }
                    return next();
                });
    
                this.app.get('/shorten', (req: express.Request, res: express.Response) => {
                    this.onShortenRequest(req, res);
                });
                this.app.all('/s/:app/:id', (req: express.Request, res: express.Response) => {
                    this.onResolveRequest(req, res);
                });
    
                this.app.set('port', this.config.port);
    
                this.app.listen(this.app.get('port'), () => {
                    this.logger.info('Proxy server listening on port :' + this.config.port);
                    resolve();
                });
            }).catch(reject)
        });
    }

    onResolveRequest(req: express.Request, res: express.Response): void {
        const code = req.params.id;
        if (!code) {
            res.status(500).send({ error: 'Please provide a short code!' });
            return;
        }
        const app = this.getApplicationById(req.params.app);
        if (!app) {
            res.status(500).type('json').send({ error: 'Application identifier not found!' });
            return;
        }
        this.resolveIdentifier(app, code).then((uri) => {
            if (uri === null) {
                res.status(404).send({ error: 'Short code not found!' });
                return;
            }
            this.logger.debug(`Resolved ${code} to ${uri}`);
            res.redirect(301, uri);
        }).catch((err) => {
            this.logger.error(`Error resolving identifier (${code})`, err);
            res.status(500).send({ error: 'Internal server error!' });
        });
    }

    onShortenRequest(req: express.Request, res: express.Response): void {
        const api = req.query.api as string;
        const app = this.getApplicationByKey(api);
        if (!app) {
            res.status(500).type('json').send({ error: 'API key not found!' });
            return;
        }
        const uri = req.query.uri as string;
        if (!uri) {
            res.status(500).type('json').send({ error: 'Please provide an uri= GET paremeter!' });
            return;
        }
        // Check cache if this URL is already shortened
        let identifier = '';
        this.resolveURI(app, uri).then((result) => {
            if (result !== null) {
                const shortUri = app.url + (app.url.endsWith('/') ? '' : '/') + result;
                res.status(200).type('json').send(shortUri);
                return Promise.reject(undefined);
            } else {
                return this.getUnusedIdentifier(app);
            }
        }).then((id) => {
            identifier = id;
            return this.setIdentifier(app, identifier, uri);
        }).then(() => {
            const shortUri = app.url + (app.url.endsWith('/') ? '' : '/') + identifier;
            this.logger.debug(`Shortened ${uri} to ${shortUri}`);
            res.status(200).type('json').send(shortUri);
        }).catch((err) => {
            if (err) {
                this.logger.error('Error shortening URL', err);
                res.status(500).send({ error: 'Internal server error!' });
            }
        });
    }

    getApplicationByKey(key: string): Application {
        return this.config.applications.find((app) => app.key === key);
    }

    getApplicationById(id: string): Application {
        return this.config.applications.find((app) => app.id === id);
    }

    setIdentifier(app: Application, identifier: string, uri: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.set(`${app.id.toLowerCase()}:short:${identifier}`, uri).then(() => {
                return this.client.set(`${app.id.toLowerCase()}:uri:${uri}`, identifier);
            }).then(() => {
                resolve();
            }).catch(reject);
        });
    }

    resolveURI(app: Application, uri: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.client.get(`${app.id.toLowerCase()}:uri:${uri}`).then((result) => {
                resolve(result);
            }).catch(reject);
        });
    }

    resolveIdentifier(app: Application, identifier: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.client.get(`${app.id.toLowerCase()}:short:${identifier}`).then((result) => {
                resolve(result);
            }).catch(reject);
        });
    }

    getUnusedIdentifier(app: Application): Promise<string> {
        return new Promise((resolve, reject) => {
            let identifier = this.makeIdentifier(app.characters, app.maxLength);
            // If it is, try again
            this.resolveIdentifier(app, identifier).then((result) => {
                if (result !== null) {
                    return this.getUnusedIdentifier(app);
                }
                return Promise.resolve(identifier);
            }).then(identifier => {
                resolve(identifier);
            }).catch(reject);
        });
    }

    makeIdentifier(characters: string, length: number) {
        let result = '';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < length) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }
}
