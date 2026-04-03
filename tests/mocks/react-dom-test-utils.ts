// Shim for react-dom/test-utils under React 19.
// React 19 removed act from the default export; it's now a named export of 'react'.
// @testing-library/react's act-compat.js checks React.act then falls back to
// react-dom/test-utils — but the fallback calls React.act again, causing a loop.
// This shim intercepts the import and provides act directly from react.
export { act } from 'react';
