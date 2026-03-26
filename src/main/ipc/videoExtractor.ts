// src/main/ipc/videoExtractor.ts
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { spawn, exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export function registerVideoExtractorIpc(win: BrowserWindow): void {

  // Return the real home directory (avoids tilde expansion issues with shell:false)
  ipcMain.removeHandler('get-home-dir');
  ipcMain.handle('get-home-dir', () => {
    return os.homedir();
  });

  // Check if yt-dlp is installed
  ipcMain.removeHandler('check-ytdlp');
  ipcMain.handle('check-ytdlp', () => {
    return new Promise<{ installed: boolean }>((resolve) => {
      exec('yt-dlp --version', (err) => {
        resolve({ installed: !err });
      });
    });
  });

  // Install yt-dlp via pip
  ipcMain.removeHandler('install-ytdlp');
  ipcMain.handle('install-ytdlp', async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const pip = spawn('pip3', ['install', 'yt-dlp'], { shell: false });
      pip.stdout.on('data', (data: Buffer) => {
        if (!win.isDestroyed()) {
          win.webContents.send('install-ytdlp-progress', { line: data.toString() });
        }
      });
      pip.stderr.on('data', (data: Buffer) => {
        if (!win.isDestroyed()) {
          win.webContents.send('install-ytdlp-progress', { line: data.toString() });
        }
      });
      pip.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: `pip3 exited with code ${code}` });
      });
    });
  });

  // Open folder picker dialog
  ipcMain.removeHandler('open-folder-dialog');
  ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: os.homedir() + '/Downloads',
    });
    return { path: result.canceled ? null : result.filePaths[0] };
  });

  // Start a yt-dlp download
  ipcMain.removeHandler('start-download');
  ipcMain.handle('start-download', async (_event, {
    url,
    outputDir,
    quality,
    format,
    audio,
  }: {
    url: string;
    outputDir: string;
    quality: string;
    format: string;
    audio: string;
  }) => {
    const args = buildYtdlpArgs(url, outputDir, quality, format, audio);
    const proc = spawn('yt-dlp', args, { shell: false });

    let lastFile = '';

    // Single stdout listener handles both progress streaming and filename tracking
    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      const percentMatch = line.match(/(\d+\.\d+)%/);
      const percent = percentMatch ? parseFloat(percentMatch[1]) : null;
      if (!win.isDestroyed()) {
        win.webContents.send('download-progress', { percent, line: line.trim() });
      }
      const destMatch = line.match(/Destination:\s+(.+)/);
      if (destMatch) lastFile = destMatch[1].trim();
      const mergeMatch = line.match(/Merging formats into "(.+?)"/);
      if (mergeMatch) lastFile = mergeMatch[1].trim();
    });

    proc.stderr.on('data', (data: Buffer) => {
      if (!win.isDestroyed()) {
        win.webContents.send('download-progress', { percent: null, line: data.toString().trim() });
      }
    });

    return new Promise<{ success: boolean; filePath?: string; error?: string }>((resolve) => {
      proc.on('close', (code) => {
        if (code === 0) {
          if (!win.isDestroyed()) {
            win.webContents.send('download-complete', { filePath: lastFile || outputDir });
          }
          resolve({ success: true, filePath: lastFile || outputDir });
        } else {
          if (!win.isDestroyed()) {
            win.webContents.send('download-error', { message: `yt-dlp exited with code ${code}` });
          }
          resolve({ success: false, error: `yt-dlp exited with code ${code}` });
        }
      });
    });
  });
}

export function buildYtdlpArgs(
  url: string,
  outputDir: string,
  quality: string,
  format: string,
  audio: string,
): string[] {
  const output = path.join(outputDir, '%(title)s.%(ext)s');
  const args: string[] = [url, '-o', output, '--newline'];

  const isAudioOnly = audio !== 'Video';

  if (isAudioOnly) {
    args.push('--extract-audio');
    const codecMap: Record<string, string> = {
      'Audio only': 'mp3',
      MP3: 'mp3',
      M4A: 'm4a',
      OPUS: 'opus',
    };
    args.push('--audio-format', codecMap[audio] ?? 'mp3');
  } else {
    // Quality selector
    const qualityMap: Record<string, string> = {
      Best: 'bestvideo+bestaudio/best',
      '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
      '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
    };
    args.push('-f', qualityMap[quality] ?? 'bestvideo+bestaudio/best');

    // Container format
    const formatMap: Record<string, string> = {
      MP4: 'mp4',
      WebM: 'webm',
      MKV: 'mkv',
    };
    args.push('--merge-output-format', formatMap[format] ?? 'mp4');
  }

  return args;
}
