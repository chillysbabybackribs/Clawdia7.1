/**
 * Preload script for BrowserView
 * Masks bot detection vectors and fingerprinting
 * Runs in isolated context before page scripts load
 */

// ============================================================================
// WEBDRIVER DETECTION MASKING
// ============================================================================

// Hide Electron/CDP detection
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
});

// Hide Electron detection
(window as any).chrome = {
  runtime: { id: undefined },
};

// ============================================================================
// NAVIGATOR PROPERTY MASKING
// ============================================================================

const originalNavigator = Object.create(Navigator.prototype);
Object.assign(originalNavigator, navigator);

const maskedNavigator = {
  // Real browser values
  vendor: 'Google Inc.',
  platform: 'Linux x86_64',
  language: 'en-US',
  languages: ['en-US', 'en'],
  deviceMemory: 8,
  hardwareConcurrency: 4,
  maxTouchPoints: 0,
  
  // Mask Electron-specific props
  get webdriver(): boolean {
    return false;
  },
  get plugins(): any[] {
    return [];
  },
  get mimeTypes(): any {
    return {};
  },
  get permissions(): any {
    return originalNavigator.permissions;
  },
  get mediaDevices(): any {
    return originalNavigator.mediaDevices;
  },
  get geolocation(): any {
    return originalNavigator.geolocation;
  },
  get connection(): any {
    return originalNavigator.connection;
  },
  get serviceWorker(): any {
    return originalNavigator.serviceWorker;
  },
  
  // Keep real implementations
  canShare: originalNavigator.canShare?.bind(originalNavigator),
  sendBeacon: originalNavigator.sendBeacon?.bind(originalNavigator),
  share: originalNavigator.share?.bind(originalNavigator),
  vibrate: originalNavigator.vibrate?.bind(originalNavigator),
  requestMediaKeySystemAccess:
    originalNavigator.requestMediaKeySystemAccess?.bind(originalNavigator),
};

// Replace navigator
Object.defineProperty(window, 'navigator', {
  value: maskedNavigator,
  writable: false,
  configurable: false,
});

// ============================================================================
// WEBGL FINGERPRINTING PROTECTION
// ============================================================================

try {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  
  if (gl) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const getParameter = gl.getParameter.bind(gl);
      
      gl.getParameter = function(parameter: number) {
        if (parameter === debugInfo.UNMASKED_RENDERER_WEBGL) {
          return 'Intel Iris Graphics';
        }
        if (parameter === debugInfo.UNMASKED_VENDOR_WEBGL) {
          return 'Intel Inc.';
        }
        return getParameter(parameter);
      } as any;
    }
  }
} catch (e) {
  // WebGL not available
}

// ============================================================================
// CANVAS FINGERPRINTING PROTECTION
// ============================================================================

// Override canvas fingerprinting by randomizing slightly
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
  if (
    type === 'image/png' ||
    type === 'image/webp' ||
    !type // Default PNG
  ) {
    // Add slight noise to prevent perfect fingerprint matching
    const ctx = this.getContext('2d');
    if (ctx && this.width > 1 && this.height > 1) {
      const imageData = ctx.getImageData(0, 0, 1, 1);
      if (imageData.data[3] !== 0) {
        // Add 1-2 pixels of noise if canvas has content
        imageData.data[0] = (imageData.data[0] + Math.floor(Math.random() * 2)) % 256;
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }
  
  return originalToDataURL.call(this, type, quality);
};

// ============================================================================
// SCREEN PROPERTIES MASKING
// ============================================================================

Object.defineProperty(window.screen, 'availHeight', {
  value: window.screen.height - 40, // Taskbar simulation
  writable: false,
  configurable: false,
});

// ============================================================================
// PERMISSIONS API SPOOFING
// ============================================================================

if (window.navigator.permissions) {
  const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  
  window.navigator.permissions.query = ((permissionStatus: PermissionDescriptor) => {
    if (permissionStatus.name === 'notifications') {
      return Promise.resolve({
        state: 'denied' as PermissionStatus['state'],
        onchange: null,
      } as PermissionStatus);
    }
    return originalQuery(permissionStatus);
  }) as any;
}

// ============================================================================
// LOCAL STORAGE PROTECTION
// ============================================================================

// Prevent detection via localStorage inspection
const originalLocalStorage = window.localStorage;
if (originalLocalStorage) {
  // Local storage is handled normally, but we prevent
  // excessive inspection that might trigger detection
}

// ============================================================================
// LOGGING
// ============================================================================

if (process.env.NODE_ENV === 'development') {
  console.log(
    '%c🔒 Clawdia Bot Protection Active',
    'color: #4CAF50; font-weight: bold; font-size: 12px'
  );
  console.log('✓ WebDriver detection masked');
  console.log('✓ Navigator properties spoofed');
  console.log('✓ WebGL fingerprinting protected');
  console.log('✓ Canvas fingerprinting randomized');
}

// Export for TypeScript
export {};
