import path, { dirname } from 'path';
import { Application } from './Application.model.js';
import fs from 'fs';
import { fileURLToPath } from 'url';

import logger from 'winston';

export interface Configuration {
    applications: Application[];
    port: number;
    log: {
        level: string;
    };
}

/**
 *
 */
export function loadConfiguration(): Configuration {
    // Load configuration
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const configPath = path.resolve(__dirname, '../../../config.json');
    const configFile = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configFile);
    return config;
}

/**
 *
 * @param config
 */
export function validateConfiguration(config: Configuration): Configuration {
    return {
        applications: config.applications.map((app: Application) => {
            app.characters =
                app.characters ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$-_.+!*'(),";
            app.maxLength = app.maxLength ?? 5;
            const combinations = Math.pow(app.characters.length, app.maxLength);
            logger.info(`Loaded application '${app.name}' from configuration ...`);
            logger.debug(`Application '${app.name}' has ${combinations} possible combinations.`);
            return app;
        }),
        port: config.port,
        log: {
            level: config.log.level,
        },
    };
}
