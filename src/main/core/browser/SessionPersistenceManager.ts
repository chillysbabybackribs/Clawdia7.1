/**
 * SessionPersistenceManager
 * Handles long-term cookie persistence, session extension, and recovery
 */

import { session } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface CookieData {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SessionSnapshot {
  domain: string;
  cookies: CookieData[];
  lastUpdated: number;
  accessCount: number;
}

const COOKIE_EXTENSION_DAYS = 365; // 1 year
const COOKIE_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24; // 24 hours
const SESSION_SNAPSHOT_DIR = 'session-snapshots';

// Electron uses lowercase sameSite values; CookieData uses Title case
function sameSiteToElectron(s?: 'Strict' | 'Lax' | 'None'): 'strict' | 'lax' | 'no_restriction' | undefined {
  if (s === 'Strict') return 'strict';
  if (s === 'Lax') return 'lax';
  if (s === 'None') return 'no_restriction';
  return undefined;
}

function sameSiteFromElectron(s?: string): 'Strict' | 'Lax' | 'None' | undefined {
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'no_restriction') return 'None';
  return undefined;
}

export class SessionPersistenceManager {
  private readonly snapshotDir: string;
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly domainPartitionMap = new Map<string, string>();

  constructor(private readonly userDataPath: string) {
    this.snapshotDir = path.join(userDataPath, SESSION_SNAPSHOT_DIR);
  }

  /**
   * Initialize persistence manager
   * Creates snapshot directory and starts maintenance loop
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.snapshotDir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    // Start cookie refresh loop
    this.startCookieMaintenanceLoop();
  }

  /**
   * Get or create partition for domain
   * Enables per-domain session isolation
   */
  getPartitionForDomain(url: string): string {
    try {
      const domain = new URL(url).hostname;
      if (!this.domainPartitionMap.has(domain)) {
        const partition = `persist:clawdia-${domain}`;
        this.domainPartitionMap.set(domain, partition);
      }
      return this.domainPartitionMap.get(domain)!;
    } catch {
      return 'persist:clawdia-browser'; // Fallback to default
    }
  }

  /**
   * Extend cookie lifetime to future date
   * Called periodically to keep sessions alive
   */
  async extendCookieLifetime(partitionKey: string): Promise<number> {
    const sess = session.fromPartition(partitionKey);
    const cookies = await sess.cookies.get({});

    if (cookies.length === 0) {
      return 0;
    }

    const now = Math.floor(Date.now() / 1000);
    const futureExpiry = now + COOKIE_EXTENSION_DAYS * 24 * 60 * 60;
    let extended = 0;

    for (const cookie of cookies) {
      // Only extend if not already far in future or if session-only
      if (!cookie.expirationDate || cookie.expirationDate < futureExpiry) {
        try {
          // Reconstruct URL for cookie setting
          const protocol = cookie.secure ? 'https://' : 'http://';
          const domain = (cookie.domain || '').replace(/^\./, '');
          const url = `${protocol}${domain}${cookie.path || '/'}`;

          await sess.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || domain,
            path: cookie.path || '/',
            secure: cookie.secure ?? false,
            httpOnly: cookie.httpOnly ?? false,
            sameSite: (cookie.sameSite === 'unspecified' ? undefined : cookie.sameSite) as 'strict' | 'lax' | 'no_restriction' | undefined,
            expirationDate: futureExpiry,
          });

          extended++;
        } catch (error) {
          console.error(`Failed to extend cookie ${cookie.name}:`, error);
        }
      }
    }

    return extended;
  }

  /**
   * Create a snapshot of current cookies for a partition
   * Used for backup and recovery
   */
  async snapshotCookies(partitionKey: string, domain: string): Promise<SessionSnapshot> {
    const sess = session.fromPartition(partitionKey);
    const cookies = await sess.cookies.get({});

    const snapshot: SessionSnapshot = {
      domain,
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: sameSiteFromElectron(c.sameSite),
      })),
      lastUpdated: Date.now(),
      accessCount: 0,
    };

    // Save to disk
    const filePath = this.getSnapshotPath(domain);
    try {
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (error) {
      console.error(`Failed to snapshot cookies for ${domain}:`, error);
    }

    return snapshot;
  }

  /**
   * Restore cookies from snapshot
   * Called on app startup to restore previous sessions
   */
  async restoreCookiesFromSnapshot(
    partitionKey: string,
    domain: string,
  ): Promise<number> {
    const filePath = this.getSnapshotPath(domain);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const snapshot = JSON.parse(raw) as SessionSnapshot;

      const sess = session.fromPartition(partitionKey);
      let restored = 0;

      const now = Math.floor(Date.now() / 1000);
      const futureExpiry = now + COOKIE_EXTENSION_DAYS * 24 * 60 * 60;

      for (const cookie of snapshot.cookies) {
        try {
          const protocol = cookie.secure ? 'https://' : 'http://';
          const url = `${protocol}${cookie.domain || domain}${cookie.path || '/'}`;

          // Always extend expiry when restoring
          await sess.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure ?? false,
            httpOnly: cookie.httpOnly ?? false,
            sameSite: sameSiteToElectron(cookie.sameSite),
            expirationDate: futureExpiry,
          });

          restored++;
        } catch (error) {
          console.warn(`Failed to restore cookie ${cookie.name}:`, error);
        }
      }

      console.log(
        `✓ Restored ${restored}/${snapshot.cookies.length} cookies for ${domain}`,
      );
      return restored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Failed to restore snapshot for ${domain}:`, error);
      }
      return 0;
    }
  }

  /**
   * Clear all snapshots (for privacy/logout)
   */
  async clearAllSnapshots(): Promise<void> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.snapshotDir, file);
          try {
            await fs.unlink(filePath);
          } catch {
            // Already deleted
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  /**
   * Clear snapshot for specific domain
   */
  async clearDomainSnapshot(domain: string): Promise<void> {
    const filePath = this.getSnapshotPath(domain);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist
    }
  }

  /**
   * Get all stored domain snapshots
   */
  async listPersistedDomains(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Start periodic cookie maintenance
   * Extends cookies daily to keep sessions alive
   */
  private startCookieMaintenanceLoop(): void {
    if (this.refreshIntervalId !== null) {
      return; // Already running
    }

    // Initial refresh after 2 seconds
    setTimeout(() => this.refreshAllCookies(), 2000);

    // Periodic refresh every 24 hours
    this.refreshIntervalId = setInterval(() => this.refreshAllCookies(), COOKIE_REFRESH_INTERVAL_MS);
  }

  /**
   * Stop cookie maintenance loop
   */
  stopMaintenanceLoop(): void {
    if (this.refreshIntervalId !== null) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  /**
   * Refresh all cookies in all partitions
   */
  private async refreshAllCookies(): Promise<void> {
    // Get all partitions with cookies
    const partitions = new Set<string>();

    // Add all known domain partitions
    for (const partition of this.domainPartitionMap.values()) {
      partitions.add(partition);
    }

    // Add default partition
    partitions.add('persist:clawdia-browser');

    let totalExtended = 0;
    for (const partition of partitions) {
      try {
        const extended = await this.extendCookieLifetime(partition);
        if (extended > 0) {
          totalExtended += extended;
        }
      } catch (error) {
        console.warn(`Failed to extend cookies for partition ${partition}:`, error);
      }
    }

    if (totalExtended > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[SessionPersistenceManager] Extended ${totalExtended} cookies`);
    }
  }

  private getSnapshotPath(domain: string): string {
    // Sanitize domain for filename
    const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
    return path.join(this.snapshotDir, `${safeDomain}.json`);
  }
}
