import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import { logger } from './logger.js';

const execAsync = promisify(exec);

/**
 * Ensures a file or directory is only accessible by the current user and SYSTEM (on Windows).
 * On POSIX, it sets permissions to 600 (file) or 700 (directory).
 */
export async function lockdownPath(targetPath: string, isDir: boolean = false): Promise<void> {
    if (!fs.existsSync(targetPath)) return;

    if (os.platform() === 'win32') {
        try {
            const username = process.env.USERNAME || os.userInfo().username;
            const grant = isDir ? '(OI)(CI)F' : 'F';

            // Remove inheritance, grant full to user and SYSTEM
            const command = `icacls "${targetPath}" /inheritance:r /grant:r "${username}:${grant}" /grant:r "SYSTEM:${grant}"`;
            await execAsync(command);
            logger.info(`Locked down permissions (Windows ACL) for: ${targetPath}`);
        } catch (err: any) {
            logger.error(`Failed to lock down ${targetPath}: ${err.message}`);
        }
    } else {
        try {
            const mode = isDir ? 0o700 : 0o600;
            fs.chmodSync(targetPath, mode);
            logger.info(`Locked down permissions (chmod) for: ${targetPath}`);
        } catch (err: any) {
            logger.error(`Failed to lock down ${targetPath}: ${err.message}`);
        }
    }
}
