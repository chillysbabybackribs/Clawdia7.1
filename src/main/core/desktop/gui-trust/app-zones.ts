import type { GuiElementNode, GuiInferenceRegion, GuiStateFingerprint } from './types';

function clampRegion(region: GuiInferenceRegion, state: GuiStateFingerprint): GuiInferenceRegion {
    const minX = state.windowBounds.x;
    const minY = state.windowBounds.y;
    const maxX = state.windowBounds.x + state.windowBounds.width;
    const maxY = state.windowBounds.y + state.windowBounds.height;
    const x = Math.max(minX, region.x);
    const y = Math.max(minY, region.y);
    const width = Math.max(1, Math.min(maxX, region.x + region.width) - x);
    const height = Math.max(1, Math.min(maxY, region.y + region.height) - y);
    return { ...region, x, y, width, height };
}

export function getRootInferenceRegions(appId: string, state: GuiStateFingerprint): GuiInferenceRegion[] {
    if (appId !== 'gimp') {
        return [{
            name: 'full-window',
            x: state.windowBounds.x,
            y: state.windowBounds.y,
            width: state.windowBounds.width,
            height: state.windowBounds.height,
        }];
    }

    const { x, y, width, height } = state.windowBounds;
    return [
        clampRegion({ name: 'menu-bar', x, y, width, height: 44 }, state),
        clampRegion({ name: 'toolbox', x, y: y + 44, width: 150, height: height - 44 }, state),
        clampRegion({ name: 'right-docks', x: x + width - 240, y: y + 44, width: 240, height: height - 44 }, state),
    ];
}

export function getChildInferenceRegion(
    appId: string,
    state: GuiStateFingerprint,
    element: GuiElementNode,
    expectedSurface: 'menu' | 'dialog' | 'dropdown' | 'tab_switch' | 'same_state' | 'unknown',
): GuiInferenceRegion | undefined {
    if (expectedSurface === 'menu' || expectedSurface === 'dropdown') {
        const baseWidth = appId === 'gimp' ? 320 : 280;
        const region: GuiInferenceRegion = {
            name: `${expectedSurface}-surface`,
            x: element.center.x - 30,
            y: element.center.y + 8,
            width: baseWidth,
            height: Math.min(520, (state.windowBounds.y + state.windowBounds.height) - (element.center.y + 8)),
        };
        return clampRegion(region, state);
    }

    if (expectedSurface === 'dialog') {
        return clampRegion({
            name: 'dialog-surface',
            x: state.windowBounds.x + Math.round(state.windowBounds.width * 0.18),
            y: state.windowBounds.y + Math.round(state.windowBounds.height * 0.12),
            width: Math.round(state.windowBounds.width * 0.64),
            height: Math.round(state.windowBounds.height * 0.72),
        }, state);
    }

    return undefined;
}
