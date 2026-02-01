import { describe, it, expect } from 'vitest';
import { PermissionManager, PermissionLevel, PermissionError } from '../src/utils/permissions.js';

describe('PermissionManager', () => {
    describe('checkPermission', () => {
        it('allows operations at or below maxLevel', () => {
            const pm = new PermissionManager({ maxLevel: 3 });
            expect(() => pm.checkPermission('test_read', PermissionLevel.READ_ONLY)).not.toThrow();
            expect(() => pm.checkPermission('test_write', PermissionLevel.WRITE_SAFE)).not.toThrow();
            expect(() => pm.checkPermission('test_exec', PermissionLevel.EXECUTE_SAFE)).not.toThrow();
        });

        it('blocks operations above maxLevel', () => {
            const pm = new PermissionManager({ maxLevel: 2 });
            expect(() => pm.checkPermission('test_exec', PermissionLevel.EXECUTE_SAFE)).toThrow(PermissionError);
            expect(() => pm.checkPermission('test_priv', PermissionLevel.PRIVILEGED)).toThrow(PermissionError);
        });
    });

    describe('checkCommand', () => {
        it('blocks denied commands', () => {
            const pm = new PermissionManager({
                maxLevel: 4,
                deniedCommands: ['rm -rf'],
            });
            expect(() => pm.checkCommand('rm -rf /')).toThrow(PermissionError);
        });

        it('allows only allowlisted commands', () => {
            const pm = new PermissionManager({
                maxLevel: 4,
                allowedCommands: ['ls', 'cat'],
            });
            expect(() => pm.checkCommand('ls -la')).not.toThrow();
            expect(() => pm.checkCommand('rm file.txt')).toThrow(PermissionError);
        });
    });

    describe('checkFilePath', () => {
        it('allows writes within allowed directories', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                allowedDirectories: ['/home/user/project'],
            });
            expect(() => pm.checkFilePath('/home/user/project/src/file.ts', 'write')).not.toThrow();
        });

        it('blocks writes outside allowed directories', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                allowedDirectories: ['/home/user/project'],
            });
            expect(() => pm.checkFilePath('/etc/passwd', 'write')).toThrow(PermissionError);
        });

        it('blocks path traversal attempts', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                allowedDirectories: ['/home/user/project'],
            });
            // path.resolve collapses ../ so this resolves to /etc/passwd
            expect(() => pm.checkFilePath('/home/user/project/../../etc/passwd', 'write')).toThrow(PermissionError);
        });

        it('blocks denied directories', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                deniedDirectories: ['/home/user/project/.git'],
            });
            expect(() => pm.checkFilePath('/home/user/project/.git/config', 'read')).toThrow(PermissionError);
        });

        it('allows reads without directory restrictions', () => {
            const pm = new PermissionManager({ maxLevel: 3 });
            expect(() => pm.checkFilePath('/any/path/file.txt', 'read')).not.toThrow();
        });
    });

    describe('checkDomain', () => {
        it('allows all domains when no allowlist', () => {
            const pm = new PermissionManager({ maxLevel: 3 });
            expect(() => pm.checkDomain('https://example.com')).not.toThrow();
        });

        it('restricts to allowed domains', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                allowedDomains: ['example.com', 'api.example.com'],
            });
            expect(() => pm.checkDomain('https://example.com/page')).not.toThrow();
            expect(() => pm.checkDomain('https://evil.com')).toThrow(PermissionError);
        });

        it('supports wildcard domains', () => {
            const pm = new PermissionManager({
                maxLevel: 3,
                allowedDomains: ['*.example.com'],
            });
            expect(() => pm.checkDomain('https://api.example.com')).not.toThrow();
            expect(() => pm.checkDomain('https://evil.com')).toThrow(PermissionError);
        });
    });

    describe('requiresApproval', () => {
        it('returns false when no approval level set', () => {
            const pm = new PermissionManager({ maxLevel: 4 });
            expect(pm.requiresApproval(PermissionLevel.PRIVILEGED)).toBe(false);
        });

        it('returns true at or above approval level', () => {
            const pm = new PermissionManager({
                maxLevel: 4,
                requireApprovalLevel: 3,
            });
            expect(pm.requiresApproval(PermissionLevel.WRITE_SAFE)).toBe(false);
            expect(pm.requiresApproval(PermissionLevel.EXECUTE_SAFE)).toBe(true);
            expect(pm.requiresApproval(PermissionLevel.PRIVILEGED)).toBe(true);
        });
    });
});
