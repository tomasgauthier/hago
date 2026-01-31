import 'dotenv/config';
import { loadConfig } from './config/load.js';
import { createContainer } from './container.js';
import { logger } from './utils/logger.js';
import { lockdownPath } from './utils/security.js';
import path from 'node:path';

async function main() {
    try {
        const config = loadConfig();

        // Security Lockdown
        logger.info('Performing security lockdown...');
        await lockdownPath(path.resolve('.env'));
        if (config.dataDir) {
            await lockdownPath(path.resolve(config.dataDir), true);
        }
        const container = createContainer(config);

        await container.start();

        logger.info('Tombot is now listening on all enabled channels.');

        process.on('SIGINT', async () => {
            logger.info('Shutting down...');
            await container.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Shutting down...');
            await container.stop();
            process.exit(0);
        });

    } catch (err: any) {
        logger.error(`Failed to start: ${err.message}`);
        process.exit(1);
    }
}

main();
