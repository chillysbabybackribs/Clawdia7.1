export type {
    GuiActionKind,
    GuiAppProfile,
    GuiCommandSpec,
    GuiElementNode,
    GuiElementRole,
    GuiSeedImportResult,
    GuiStateFingerprint,
    GuiTrustEdge,
    GuiTrustGraph,
    GuiTrustSession,
    GuiWindowContext,
} from './types';

export {
    beginGuiTrustSession,
    captureGuiStateFingerprint,
    createDefaultGuiAppProfile,
    getDefaultGuiTrustArtifactRoot,
    getSessionRunDir,
} from './state-fingerprint';

export {
    appendStateToGraph,
    createEmptyGuiTrustGraph,
    writeGuiSeedImportArtifacts,
    writeGuiTrustSessionArtifacts,
} from './artifact-writer';

export { importGuiTrustSeedFromAppArtifacts } from './seed-import';
export { inferGuiElements } from './element-inference';
export {
    classifyProbeRisk,
    inferExpectedSurface,
    inferProbeAction,
    resolveProbePoint,
} from './probe-policy';
export { probeGuiElement } from './probe-engine';
export { crawlTrustedSurfaces } from './trust-crawler';
export { getChildInferenceRegion, getRootInferenceRegions } from './app-zones';
