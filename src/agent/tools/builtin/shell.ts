import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';

export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

// Allowed command prefixes — only these programs can be invoked.
// Add more as needed for your workflow.
const ALLOWED_COMMANDS: string[] = [
    'npm', 'tsc', 'git',
    'ls', 'dir', 'cat', 'type', 'echo', 'pwd',
    'mkdir', 'cp', 'mv',
    'Get-ChildItem', 'Get-Content', 'Get-Date',
    'vitest',
];

// Patterns that should NEVER appear in a command — prevents exfiltration & escalation
const BLOCKED_PATTERNS: RegExp[] = [
    // ── Command substitution & chaining (CRITICAL — prevents injection via arguments) ──
    /`/,                  // backtick command substitution
    /\$\(/,              // $() command substitution
    /\|/,                // pipe (prevents chaining to exfil commands)
    /;/,                 // command chaining
    /&&/,                // conditional chaining
    /\|\|/,              // OR chaining
    />\s*/,              // output redirection
    /<\s*/,              // input redirection
    /\$\{/,              // variable expansion ${...}

    // ── Network exfiltration ──
    /curl\s/i,
    /wget\s/i,
    /Invoke-WebRequest/i,
    /Invoke-RestMethod/i,
    /Start-Process/i,
    /Net\.WebClient/i,
    /ssh\s/i,
    /scp\s/i,
    /ftp\s/i,
    /nc\s/i,           // netcat
    /ncat\s/i,

    // ── Shell escalation ──
    /powershell\s.*-e/i, // encoded commands
    /cmd\s*\/c/i,
    /reg\s+(add|delete|export|import)/i,

    // ── Environment variable access ──
    /\benv\b.*PASSWORD/i,
    /\benv\b.*SECRET/i,
    /\benv\b.*TOKEN/i,
    /\benv\b.*KEY/i,
    /\$env:/i,          // PowerShell env access
    /\btype\b.*\.env/i, // reading .env
    /cat\s+.*\.env/i,
    /Get-Content.*\.env/i,

    // ── Inline code execution ──
    /\bnode\b/i,
    /\bnpx\b/i,
    /\btsx\b/i,

    // ── Destructive operations ──
    /\brm\s/i,
    /\bRemove-Item/i,
    /\bdel\s/i,
];

// Sensitive file patterns that cat/type/Get-Content must NOT read
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
    /\.env$/i,
    /\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /creds/i,
    /credentials/i,
    /secret/i,
    /\.enc$/i,
    /config\.json5$/i,      // contains provider config
    /config\.json5\.bak$/i,
];

function validateCommand(command: string): void {
    const trimmed = command.trim();

    // Check against blocked patterns first
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            throw new Error(
                `Shell command blocked: matches forbidden pattern "${pattern.source}". ` +
                `This command could access secrets or make network requests.`
            );
        }
    }

    // Extract the base command (first token, ignoring leading env vars like VAR=val)
    const tokens = trimmed.split(/\s+/);
    let baseCmd = tokens[0];

    // Handle "VAR=value command" syntax (Unix)
    while (baseCmd.includes('=') && tokens.length > 1) {
        tokens.shift();
        baseCmd = tokens[0];
    }

    // Strip path prefixes to get just the executable name
    baseCmd = path.basename(baseCmd).replace(/\.exe$/i, '');

    const isAllowed = ALLOWED_COMMANDS.some(
        allowed => baseCmd.toLowerCase() === allowed.toLowerCase()
    );

    if (!isAllowed) {
        throw new Error(
            `Shell command blocked: "${baseCmd}" is not in the allowed command list. ` +
            `Allowed: ${ALLOWED_COMMANDS.join(', ')}`
        );
    }

    // For file-reading commands, block access to sensitive files
    const FILE_READ_COMMANDS = ['cat', 'type', 'get-content', 'get-childitem'];
    if (FILE_READ_COMMANDS.includes(baseCmd.toLowerCase())) {
        const rest = trimmed.slice(trimmed.indexOf(baseCmd) + baseCmd.length);
        for (const pattern of SENSITIVE_FILE_PATTERNS) {
            if (pattern.test(rest)) {
                throw new Error(
                    `Shell command blocked: reading sensitive file matching "${pattern.source}" is not allowed.`
                );
            }
        }
    }
}

function resolvePowerShellPath(): string {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (systemRoot) {
        const candidate = path.join(
            systemRoot,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'powershell.exe';
}

function getShellConfig(): { shell: string; args: string[] } {
    if (process.platform === 'win32') {
        return {
            shell: resolvePowerShellPath(),
            args: ['-NoProfile', '-NonInteractive', '-Command'],
        };
    }
    return { shell: 'sh', args: ['-c'] };
}

export const shellExecuteTool = {
    name: 'shell_execute',
    description: [
        'Execute a command in the shell. Only allowlisted commands can be run.',
        `Allowed commands: ${ALLOWED_COMMANDS.join(', ')}.`,
        'Network requests, secret access, and encoded commands are blocked.',
    ].join(' '),
    parameters: z.object({
        command: z.string().describe('The command to execute'),
        cwd: z.string().optional().describe('Optional working directory (relative to project root)'),
        timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30000)')
    }),
    async execute(args: { command: string; cwd?: string; timeout?: number }): Promise<ShellResult> {
        const { command, cwd, timeout = 30000 } = args;
        const projectRoot = process.cwd();
        const effectiveCwd = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

        // Security: ensure CWD is within project root
        if (!effectiveCwd.startsWith(projectRoot)) {
            throw new Error(`Permission denied: CWD ${effectiveCwd} is outside project root ${projectRoot}`);
        }

        // Security: validate command against allowlist and blocklist
        validateCommand(command);

        const { shell, args: shellArgs } = getShellConfig();
        logger.info(`Executing shell command: ${command} in ${effectiveCwd}`);

        // Audit log the shell execution
        const audit = (global as any).container?.audit;
        if (audit) {
            audit.log({
                action: 'shell_execute',
                detail: `Command: ${command} | CWD: ${effectiveCwd}`,
            });
        }

        return new Promise((resolve, reject) => {
            // Allowlist: only pass safe env vars to the child process
            const ENV_ALLOWLIST = [
                'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
                'TERM', 'COLORTERM', 'EDITOR', 'VISUAL',
                'NODE_ENV', 'NODE_PATH', 'NPM_CONFIG_PREFIX',
                'TMPDIR', 'TMP', 'TEMP',
                'SystemRoot', 'WINDIR', 'COMSPEC', 'ProgramFiles',
            ];
            const safeEnv: Record<string, string> = {};
            for (const key of ENV_ALLOWLIST) {
                if (process.env[key]) safeEnv[key] = process.env[key]!;
            }

            const child = spawn(shell, [...shellArgs, command], {
                cwd: effectiveCwd,
                env: safeEnv,
                shell: false,
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';
            const MAX_OUTPUT = 50_000; // 50KB cap per stream

            child.stdout?.on('data', (data) => {
                if (stdout.length < MAX_OUTPUT) {
                    stdout += data.toString();
                }
            });

            child.stderr?.on('data', (data) => {
                if (stderr.length < MAX_OUTPUT) {
                    stderr += data.toString();
                }
            });

            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                resolve({
                    stdout: stdout.slice(0, MAX_OUTPUT),
                    stderr: (stderr + '\n[Error: Command timed out]').slice(0, MAX_OUTPUT),
                    exitCode: -1
                });
            }, timeout);

            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    stdout: stdout.slice(0, MAX_OUTPUT),
                    stderr: stderr.slice(0, MAX_OUTPUT),
                    exitCode: code,
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                logger.error(`Shell execution error: ${err.message}`);
                reject(err);
            });
        });
    }
};
