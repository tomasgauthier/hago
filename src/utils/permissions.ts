/**
 * Permission system for controlling access to dangerous operations
 */

export enum PermissionLevel {
  /** Read-only operations: web fetch, file read, list directories */
  READ_ONLY = 1,
  /** Write operations to whitelisted locations: write files, create directories */
  WRITE_SAFE = 2,
  /** Execute safe operations: run whitelisted commands, browser automation */
  EXECUTE_SAFE = 3,
  /** Privileged operations: unrestricted file access, command execution, self-modification */
  PRIVILEGED = 4,
}

export interface PermissionConfig {
  /** Maximum permission level allowed */
  maxLevel: PermissionLevel;
  /** Whitelisted directories for file operations */
  allowedDirectories?: string[];
  /** Blacklisted directories (always forbidden) */
  deniedDirectories?: string[];
  /** Whitelisted commands for execution */
  allowedCommands?: string[];
  /** Blacklisted commands (always forbidden) */
  deniedCommands?: string[];
  /** Allowed domains for browser automation */
  allowedDomains?: string[];
  /** Require user approval for operations at or above this level */
  requireApprovalLevel?: PermissionLevel;
}

export class PermissionError extends Error {
  constructor(
    message: string,
    public operation: string,
    public requiredLevel: PermissionLevel,
    public currentLevel: PermissionLevel
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class PermissionManager {
  private config: PermissionConfig;

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  /**
   * Check if an operation is allowed based on permission level
   */
  checkPermission(operation: string, requiredLevel: PermissionLevel): void {
    if (requiredLevel > this.config.maxLevel) {
      throw new PermissionError(
        `Operation "${operation}" requires permission level ${PermissionLevel[requiredLevel]} but only ${PermissionLevel[this.config.maxLevel]} is allowed`,
        operation,
        requiredLevel,
        this.config.maxLevel
      );
    }
  }

  /**
   * Check if a file path is allowed for operations
   */
  checkFilePath(filePath: string, operation: 'read' | 'write' | 'delete'): void {
    const normalizedPath = this.normalizePath(filePath);

    // Check denied directories first (blacklist takes precedence)
    if (this.config.deniedDirectories) {
      for (const denied of this.config.deniedDirectories) {
        if (this.isWithinDirectory(normalizedPath, this.normalizePath(denied))) {
          throw new PermissionError(
            `Access to path "${filePath}" is explicitly denied`,
            `file_${operation}`,
            PermissionLevel.PRIVILEGED,
            this.config.maxLevel
          );
        }
      }
    }

    // For write/delete operations, check whitelist
    if (operation === 'write' || operation === 'delete') {
      if (this.config.allowedDirectories && this.config.allowedDirectories.length > 0) {
        let allowed = false;
        for (const allowedDir of this.config.allowedDirectories) {
          if (this.isWithinDirectory(normalizedPath, this.normalizePath(allowedDir))) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          throw new PermissionError(
            `Write/delete operations to "${filePath}" are not in the allowed directories`,
            `file_${operation}`,
            PermissionLevel.PRIVILEGED,
            this.config.maxLevel
          );
        }
      }
    }
  }

  /**
   * Check if a command is allowed for execution
   */
  checkCommand(command: string): void {
    const commandName = command.trim().split(/\s+/)[0];

    // Check denied commands first
    if (this.config.deniedCommands) {
      for (const denied of this.config.deniedCommands) {
        if (commandName === denied || command.includes(denied)) {
          throw new PermissionError(
            `Command "${commandName}" is explicitly denied`,
            'execute_command',
            PermissionLevel.PRIVILEGED,
            this.config.maxLevel
          );
        }
      }
    }

    // Check allowed commands
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      let allowed = false;
      for (const allowedCmd of this.config.allowedCommands) {
        if (commandName === allowedCmd) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        throw new PermissionError(
          `Command "${commandName}" is not in the allowed commands list`,
          'execute_command',
          PermissionLevel.PRIVILEGED,
          this.config.maxLevel
        );
      }
    }
  }

  /**
   * Check if a domain is allowed for browser automation
   */
  checkDomain(url: string): void {
    if (!this.config.allowedDomains || this.config.allowedDomains.length === 0) {
      return; // No restrictions if no domains specified
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      let allowed = false;
      for (const allowedDomain of this.config.allowedDomains) {
        // Support wildcards like *.example.com
        if (allowedDomain.startsWith('*.')) {
          const domainSuffix = allowedDomain.slice(2);
          if (hostname.endsWith(domainSuffix)) {
            allowed = true;
            break;
          }
        } else if (hostname === allowedDomain) {
          allowed = true;
          break;
        }
      }

      if (!allowed) {
        throw new PermissionError(
          `Domain "${hostname}" is not in the allowed domains list`,
          'browser_navigate',
          PermissionLevel.EXECUTE_SAFE,
          this.config.maxLevel
        );
      }
    } catch (err) {
      if (err instanceof PermissionError) throw err;
      throw new PermissionError(
        `Invalid URL: ${url}`,
        'browser_navigate',
        PermissionLevel.EXECUTE_SAFE,
        this.config.maxLevel
      );
    }
  }

  /**
   * Check if user approval is required for this operation
   */
  requiresApproval(operationLevel: PermissionLevel): boolean {
    if (!this.config.requireApprovalLevel) return false;
    return operationLevel >= this.config.requireApprovalLevel;
  }

  /**
   * Check if a path is within a directory using proper boundary check.
   * Prevents "/allowed-dir" from matching "/allowed-directory-evil".
   */
  private isWithinDirectory(normalizedPath: string, normalizedDir: string): boolean {
    // Ensure directory path ends with separator for exact boundary matching
    const dirWithSep = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
    return normalizedPath === normalizedDir || normalizedPath.startsWith(dirWithSep);
  }

  private normalizePath(inputPath: string): string {
    // Resolve to absolute path first (handles ../ traversal), then normalize
    const resolved = inputPath.startsWith('/')
      ? inputPath
      : inputPath; // relative paths stay relative for pattern matching
    return resolved.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  }
}

/**
 * Default permission configurations for different security profiles
 */
export const PermissionProfiles = {
  /** Safest: Read-only access, no execution */
  READONLY: {
    maxLevel: PermissionLevel.READ_ONLY,
    requireApprovalLevel: PermissionLevel.WRITE_SAFE,
  } as PermissionConfig,

  /** Moderate: Can write to data directory and execute safe commands */
  MODERATE: {
    maxLevel: PermissionLevel.WRITE_SAFE,
    allowedDirectories: ['./data', './tmp', './.mind'],
    deniedDirectories: ['./src', './node_modules', './.git'],
    deniedCommands: ['rm -rf', 'format', 'del /f', 'shutdown', 'reboot'],
    requireApprovalLevel: PermissionLevel.EXECUTE_SAFE,
  } as PermissionConfig,

  /** Permissive: Can execute commands and automate browser, requires approval for privileged ops */
  PERMISSIVE: {
    maxLevel: PermissionLevel.EXECUTE_SAFE,
    allowedDirectories: ['./data', './tmp', './.mind', './logs'],
    deniedDirectories: ['./node_modules', './.git'],
    deniedCommands: ['rm -rf /', 'format c:', 'del /f /s /q c:\\', 'shutdown', 'reboot'],
    allowedDomains: [], // Empty means allow all domains
    requireApprovalLevel: PermissionLevel.PRIVILEGED,
  } as PermissionConfig,

  /** Full access: No restrictions (use with caution) */
  UNRESTRICTED: {
    maxLevel: PermissionLevel.PRIVILEGED,
  } as PermissionConfig,
};
