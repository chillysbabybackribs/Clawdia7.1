import { session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const PARTITION = 'persist:clawdia-browser';
const PERSIST_FILE = 'browser-extensions.json';

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  dirPath: string;
  description?: string;
  iconUrl?: string;
}

export class ExtensionManager {
  private readonly persistPath: string;

  constructor(private readonly userDataPath: string) {
    this.persistPath = path.join(userDataPath, PERSIST_FILE);
  }

  /** Load all persisted extensions into the session. Call once at startup. */
  async init(): Promise<void> {
    const paths = this.readPersistedPaths();
    for (const dirPath of paths) {
      if (!fs.existsSync(dirPath)) continue;
      try {
        await session.fromPartition(PARTITION).loadExtension(dirPath, { allowFileAccess: true });
      } catch (err) {
        console.warn(`[ExtensionManager] Failed to load extension at ${dirPath}:`, err);
      }
    }
  }

  /** Install an extension from an unpacked directory. */
  async install(dirPath: string): Promise<InstalledExtension> {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Extension directory not found: ${resolved}`);
    }

    const ext = await session.fromPartition(PARTITION).loadExtension(resolved, { allowFileAccess: true });

    this.persistPath_addDir(resolved);

    return this.toInstalled(ext, resolved);
  }

  /** Remove an installed extension by its ID. */
  async remove(id: string): Promise<void> {
    const ses = session.fromPartition(PARTITION);
    const all = ses.getAllExtensions();
    const ext = all.find((e) => e.id === id);
    if (!ext) throw new Error(`Extension not found: ${id}`);

    await ses.removeExtension(id);

    // Find the path of this extension to remove from persist list
    const persisted = this.readPersistedPaths();
    const extPath = this.findExtPathById(persisted, id);
    if (extPath) {
      this.persistPath_removeDir(extPath);
    }
  }

  /** List all currently loaded extensions. */
  list(): InstalledExtension[] {
    const ses = session.fromPartition(PARTITION);
    const persisted = this.readPersistedPaths();
    return ses.getAllExtensions().map((ext) => {
      const dirPath = this.findExtPathById(persisted, ext.id) ?? '';
      return this.toInstalled(ext, dirPath);
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private toInstalled(ext: Electron.Extension, dirPath: string): InstalledExtension {
    const manifest = ext.manifest as Record<string, unknown>;
    const iconUrl = this.resolveIconUrl(ext, dirPath);
    return {
      id: ext.id,
      name: ext.name,
      version: ext.version,
      dirPath,
      description: typeof manifest.description === 'string' ? manifest.description : undefined,
      iconUrl,
    };
  }

  private resolveIconUrl(ext: Electron.Extension, dirPath: string): string | undefined {
    if (!dirPath) return undefined;
    const manifest = ext.manifest as Record<string, unknown>;
    const icons = manifest.icons as Record<string, string> | undefined;
    if (!icons) return undefined;
    // Prefer 128 → 64 → 48 → first available
    const size = (['128', '64', '48'] as const).find((s) => icons[s]) ?? Object.keys(icons)[0];
    if (!size) return undefined;
    const iconFile = path.join(dirPath, icons[size]);
    if (fs.existsSync(iconFile)) return `file://${iconFile}`;
    return undefined;
  }

  private readPersistedPaths(): string[] {
    try {
      if (!fs.existsSync(this.persistPath)) return [];
      return JSON.parse(fs.readFileSync(this.persistPath, 'utf8')) as string[];
    } catch {
      return [];
    }
  }

  private writePaths(paths: string[]): void {
    fs.writeFileSync(this.persistPath, JSON.stringify(paths, null, 2), 'utf8');
  }

  private persistPath_addDir(dirPath: string): void {
    const paths = this.readPersistedPaths();
    if (!paths.includes(dirPath)) {
      paths.push(dirPath);
      this.writePaths(paths);
    }
  }

  private persistPath_removeDir(dirPath: string): void {
    const paths = this.readPersistedPaths().filter((p) => p !== dirPath);
    this.writePaths(paths);
  }

  private findExtPathById(persistedPaths: string[], id: string): string | undefined {
    // Walk each persisted path and read its manifest to match the ID
    for (const dirPath of persistedPaths) {
      try {
        const manifestFile = path.join(dirPath, 'manifest.json');
        if (!fs.existsSync(manifestFile)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
        // Chrome extension IDs are derived from the public key; Electron assigns them at load time.
        // We match by name+version as a fallback heuristic.
        const ses = session.fromPartition(PARTITION);
        const loaded = ses.getAllExtensions().find((e) =>
          e.name === manifest.name && e.version === manifest.version
        );
        if (loaded && loaded.id === id) return dirPath;
      } catch {
        // skip
      }
    }
    return persistedPaths.find((p) => {
      // last resort: try matching by dir basename against known loaded ext name
      return false;
    });
  }
}
