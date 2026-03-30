/**
 * BotDetectionMitigation
 * Handles user-agent rotation, request header customization,
 * and other bot detection evasion techniques
 */

import { WebContents } from 'electron';

export interface UserAgentProfile {
  name: string;
  userAgent: string;
  platform: string;
  platformVersion: string;
}

// Real Chrome user-agents across platforms
// Updated: March 2024
const USER_AGENT_PROFILES: UserAgentProfile[] = [
  // Windows - Chrome 120
  {
    name: 'Chrome/Windows/120',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Win32',
    platformVersion: '10.0',
  },
  // Windows - Chrome 121
  {
    name: 'Chrome/Windows/121',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    platform: 'Win32',
    platformVersion: '10.0',
  },
  // macOS - Chrome 120
  {
    name: 'Chrome/macOS/120',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    platformVersion: '10.15.7',
  },
  // macOS - Chrome 121
  {
    name: 'Chrome/macOS/121',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    platformVersion: '10.15.7',
  },
  // macOS ARM - Chrome 120
  {
    name: 'Chrome/macOS-ARM/120',
    userAgent:
      'Mozilla/5.0 (Macintosh; PPC Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'MacPPC',
    platformVersion: '10.15.7',
  },
  // Linux - Chrome 120
  {
    name: 'Chrome/Linux/120',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    platformVersion: '5.15.0',
  },
];

export class BotDetectionMitigation {
  private lastSelectedIndex = -1;
  private tabUserAgentMap = new Map<Electron.WebContents, UserAgentProfile>();

  /**
   * Set user-agent for a WebContents instance
   * Optionally select specific profile or randomize
   */
  setUserAgent(webContents: WebContents, profileIndex?: number): UserAgentProfile {
    let profile: UserAgentProfile;

    if (profileIndex !== undefined && profileIndex >= 0 && profileIndex < USER_AGENT_PROFILES.length) {
      profile = USER_AGENT_PROFILES[profileIndex];
    } else {
      // Randomize with some weighting toward more common platforms
      profile = this.selectRandomUserAgent();
    }

    webContents.userAgent = profile.userAgent;
    this.tabUserAgentMap.set(webContents, profile);

    return profile;
  }

  /**
   * Set up request header customization for a tab
   * Mimics real browser request patterns
   */
  setupRequestHeaderCustomization(webContents: WebContents): void {
    webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };

      // Add/customize browser-like headers
      headers['Accept-Language'] = this.getRandomAcceptLanguage();
      headers['Accept-Encoding'] = 'gzip, deflate, br';
      headers['Sec-Fetch-Dest'] = this.getSecFetchDest(details.url);
      headers['Sec-Fetch-Mode'] = this.getSecFetchMode(details.url);
      headers['Sec-Fetch-Site'] = this.getSecFetchSite(details.url);
      headers['Sec-Fetch-User'] = '?1';
      headers['Sec-Ch-Ua-Mobile'] = '?0';
      headers['Sec-Ch-Ua-Platform'] = this.getPlatformString();
      headers['Sec-Ch-Ua'] = this.getChromeUAHint();
      headers['Upgrade-Insecure-Requests'] = '1';
      headers['DNT'] = '1';

      // Selective Referer (don't set for all requests)
      if (this.shouldAddReferer(details.url)) {
        headers['Referer'] = this.generateContextualReferer(details.url);
      }

      callback({ requestHeaders: headers });
    });
  }

  /**
   * Get user-agent profile for a WebContents
   */
  getUserAgentProfile(webContents: WebContents): UserAgentProfile | undefined {
    return this.tabUserAgentMap.get(webContents);
  }

  /**
   * Clear user-agent profile when tab is closed
   */
  clearUserAgentProfile(webContents: WebContents): void {
    this.tabUserAgentMap.delete(webContents);
  }

  /**
   * Get all registered profiles
   */
  getAvailableProfiles(): UserAgentProfile[] {
    return [...USER_AGENT_PROFILES];
  }

  // ========================================================================
  // PRIVATE HELPER METHODS
  // ========================================================================

  private selectRandomUserAgent(): UserAgentProfile {
    // Favor Windows (60%), macOS (25%), Linux (15%)
    const rand = Math.random();
    let index: number;

    if (rand < 0.6) {
      // Windows: indices 0-1
      index = Math.floor(Math.random() * 2);
    } else if (rand < 0.85) {
      // macOS: indices 2-4
      index = 2 + Math.floor(Math.random() * 3);
    } else {
      // Linux: index 5
      index = 5;
    }

    this.lastSelectedIndex = index;
    return USER_AGENT_PROFILES[index];
  }

  private getRandomAcceptLanguage(): string {
    const languages = [
      'en-US,en;q=0.9',
      'en-US,en;q=0.9,es;q=0.8',
      'en-US,en;q=0.9,fr;q=0.8',
      'en-US,en;q=0.9,de;q=0.8',
      'en-US,en;q=0.9,ja;q=0.8',
    ];
    return languages[Math.floor(Math.random() * languages.length)];
  }

  private getSecFetchDest(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('.js') || lower.endsWith('js')) return 'script';
    if (lower.includes('.css') || lower.endsWith('css')) return 'style';
    if (lower.includes('.woff') || lower.includes('.ttf')) return 'font';
    if (lower.includes('.png') || lower.includes('.jpg') || lower.includes('.gif')) {
      return 'image';
    }
    return 'document';
  }

  private getSecFetchMode(url: string): string {
    // Most requests are navigate or cors
    return Math.random() > 0.7 ? 'cors' : 'navigate';
  }

  private getSecFetchSite(url: string): string {
    // Most are same-site or none
    const rand = Math.random();
    if (rand < 0.7) return 'none';
    if (rand < 0.85) return 'same-site';
    return 'cross-site';
  }

  private getPlatformString(): string {
    const profile = USER_AGENT_PROFILES[this.lastSelectedIndex];
    if (!profile) return 'Linux';

    if (profile.platform === 'Win32') return 'Windows';
    if (profile.platform.includes('Mac')) return 'macOS';
    return 'Linux';
  }

  private getChromeUAHint(): string {
    // Sec-Ch-Ua header for Chrome
    const version = this.lastSelectedIndex < 2 ? '120' : '121';
    return `"Not_A Brand";v="8", "Chromium";v="${version}", "Google Chrome";v="${version}"`;
  }

  private shouldAddReferer(url: string): boolean {
    // Don't add referer for some sensitive operations
    const lower = url.toLowerCase();
    if (lower.includes('login') || lower.includes('logout')) {
      return Math.random() > 0.3; // 70% chance
    }
    if (lower.includes('/api/')) {
      return Math.random() > 0.5; // 50% chance
    }
    return true; // 100% for regular navigation
  }

  private generateContextualReferer(currentUrl: string): string {
    try {
      const url = new URL(currentUrl);
      // Return just the origin as referer
      return url.origin + '/';
    } catch {
      return 'https://www.google.com/';
    }
  }
}
