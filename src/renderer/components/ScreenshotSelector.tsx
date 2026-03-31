import { useEffect } from 'react';

interface Props {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}

/**
 * Invisible component — on mount it immediately invokes the system screenshot
 * tool (gnome-screenshot -a / scrot -s) which provides its own native UI.
 * On completion the captured image is passed back via onCapture.
 */
export default function ScreenshotSelector({ onCapture, onCancel }: Props) {
  useEffect(() => {
    let cancelled = false;
    const api = (window as any).clawdia;
    api.screenshot.capture().then((result: { dataUrl?: string; error?: string }) => {
      if (cancelled) return;
      if (result?.dataUrl) {
        onCapture(result.dataUrl);
      } else {
        onCancel();
      }
    }).catch(() => {
      if (!cancelled) onCancel();
    });
    return () => { cancelled = true; };
  }, []);

  return null;
}
