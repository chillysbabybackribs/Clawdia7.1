// src/main/core/desktop/screen-map-types.ts
//
// Data model for a screen mapping session.
// Sessions accumulate labeled coordinate hits so automation can reference
// stable named anchors instead of raw x/y literals.

export interface MonitorInfo {
  width: number;
  height: number;
  originX: number;
  originY: number;
  /** xrandr display name e.g. "HDMI-1-0" */
  name: string;
}

export interface WindowContext {
  appName: string;
  windowTitle: string;
  /** Absolute screen coordinates of the window at the time of the hit */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface MapPoint {
  id: string;
  x: number;
  y: number;
  timestampMs: number;
  /** Human-readable label: "Settings button", "Scene + btn", etc. */
  label: string;
  /** What kind of interaction this point represents */
  action: 'click' | 'right_click' | 'double_click' | 'hover' | 'manual';
  /** Monitor the point lives on */
  monitorName: string;
  /** Window snapshot at click time (if available) */
  windowContext?: WindowContext;
  /** Path to screenshot taken at this point (if any) */
  screenshotPath?: string;
  /** Relative coords within the window (x - window.x, y - window.y) */
  relativeX?: number;
  relativeY?: number;
  /** Notes or observations */
  notes?: string;
}

export interface ScreenMapSession {
  id: string;
  createdAt: string;          // ISO-8601
  updatedAt: string;
  /** App being mapped */
  appName: string;
  /** Free-form description */
  description: string;
  monitors: MonitorInfo[];
  points: MapPoint[];
  /** Path to the baseline full-screen screenshot taken at session start */
  baselineScreenshot?: string;
}
