export interface CoordinateProposalPromptInput {
  appName: string;
  windowTitle: string;
  targetDescription: string;
  screenshotPath: string;
  windowBounds: { x: number; y: number; width: number; height: number };
  sectionLabel?: string;
  sectionBounds?: { x: number; y: number; width: number; height: number };
  notes?: string[];
}

export interface CoordinateValidationPromptInput extends CoordinateProposalPromptInput {
  cursor: { x: number; y: number };
}

export function buildCoordinateProposalPrompt(input: CoordinateProposalPromptInput): string {
  const notes = input.notes?.length ? `Additional notes:\n${input.notes.map((note) => `- ${note}`).join('\n')}\n\n` : '';
  const sectionLine = input.sectionLabel ? `Section label: ${input.sectionLabel}` : '';
  const sectionBoundsLine = input.sectionBounds
    ? `Section bounds: x=${input.sectionBounds.x}, y=${input.sectionBounds.y}, width=${input.sectionBounds.width}, height=${input.sectionBounds.height}`
    : '';
  return [
    'You are a desktop GUI mapping assistant.',
    'Phase 1 only: work on one section and one coordinate only.',
    'Your job is to identify a single target in the screenshot and propose the best cursor coordinate for it inside the named section.',
    'Be conservative. Prefer exactness over guessing.',
    '',
    `App: ${input.appName}`,
    `Window title: ${input.windowTitle}`,
    `Screenshot: ${input.screenshotPath}`,
    `Window bounds: x=${input.windowBounds.x}, y=${input.windowBounds.y}, width=${input.windowBounds.width}, height=${input.windowBounds.height}`,
    sectionLine,
    sectionBoundsLine,
    `Target description: ${input.targetDescription}`,
    '',
    notes.trim(),
    'Return JSON only with this shape:',
    '{',
    '  "label": "short stable label",',
    '  "role": "menu_item|button|tab|icon_button|input|unknown",',
    '  "x": 0,',
    '  "y": 0,',
    '  "confidence": 0.0,',
    '  "reason": "why this point is correct"',
    '}',
    '',
    'Rules:',
    '- Only reason about the named section. Do not propose coordinates from other sections.',
    '- The coordinate must be inside the visible target.',
    '- Prefer the visual center of the clickable area.',
    '- If the target is not clearly visible, return confidence below 0.5 and explain why.',
  ].filter(Boolean).join('\n');
}

export function buildCoordinateValidationPrompt(input: CoordinateValidationPromptInput): string {
  const notes = input.notes?.length ? `Additional notes:\n${input.notes.map((note) => `- ${note}`).join('\n')}\n\n` : '';
  const sectionLine = input.sectionLabel ? `Section label: ${input.sectionLabel}` : '';
  const sectionBoundsLine = input.sectionBounds
    ? `Section bounds: x=${input.sectionBounds.x}, y=${input.sectionBounds.y}, width=${input.sectionBounds.width}, height=${input.sectionBounds.height}`
    : '';
  return [
    'You are a desktop GUI mapping validator.',
    'Phase 1 only: this is a strict hover-only calibration task.',
    'Your job is to judge whether the current cursor coordinate is exactly on the intended target in the screenshot.',
    'Do not assume any click occurred or should occur.',
    '',
    `App: ${input.appName}`,
    `Window title: ${input.windowTitle}`,
    `Screenshot: ${input.screenshotPath}`,
    `Window bounds: x=${input.windowBounds.x}, y=${input.windowBounds.y}, width=${input.windowBounds.width}, height=${input.windowBounds.height}`,
    sectionLine,
    sectionBoundsLine,
    `Target description: ${input.targetDescription}`,
    `Cursor coordinate: x=${input.cursor.x}, y=${input.cursor.y}`,
    '',
    notes.trim(),
    'Return JSON only with this shape:',
    '{',
    '  "status": "exact|adjust|wrong_target",',
    '  "dx": 0,',
    '  "dy": 0,',
    '  "confidence": 0.0,',
    '  "reason": "why this coordinate is or is not correct"',
    '}',
    '',
    'Rules:',
    '- Only judge the named section. Do not validate against other sections.',
    '- Use "exact" only if the cursor is already in the correct clickable spot.',
    '- Use "adjust" if the cursor is close and can be corrected with dx/dy.',
    '- Use "wrong_target" if the cursor is not on the intended target.',
    '- dx and dy should be the smallest correction needed.',
  ].filter(Boolean).join('\n');
}
