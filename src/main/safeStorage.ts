// src/main/safeStorage.ts
// Encrypts/decrypts sensitive strings using Electron's safeStorage API,
// which delegates to the OS keychain (libsecret/GNOME Keyring on Linux,
// Keychain on macOS, DPAPI on Windows).
import { safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const VAULT_FILENAME = 'clawdia-vault.json';

interface VaultData {
  [key: string]: string; // key → base64-encoded encrypted buffer
}

function vaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function loadVault(): VaultData {
  try {
    const p = vaultPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveVault(data: VaultData): void {
  try {
    const p = vaultPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Ignore disk errors
  }
}

/** Check if OS keychain encryption is available. */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** Encrypt and store a secret under a key name. */
export function storeSecret(key: string, plaintext: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(plaintext);
  const vault = loadVault();
  vault[key] = encrypted.toString('base64');
  saveVault(vault);
  return true;
}

/** Retrieve and decrypt a secret by key name. Returns null if not found or encryption unavailable. */
export function retrieveSecret(key: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const vault = loadVault();
  const encoded = vault[key];
  if (!encoded) return null;
  try {
    const buffer = Buffer.from(encoded, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}

/** Delete a secret from the vault. */
export function deleteSecret(key: string): boolean {
  const vault = loadVault();
  if (!(key in vault)) return false;
  delete vault[key];
  saveVault(vault);
  return true;
}

/** List all stored secret key names (not values). */
export function listSecretKeys(): string[] {
  return Object.keys(loadVault());
}
