import { os } from '@orpc/server';
import { dialog, type BrowserWindow } from 'electron';

export function createRecordingRoutes(mainWindow: BrowserWindow) {
  return {
    pickFile: os.handler(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          {
            name: '视频',
            extensions: ['mp4', 'mkv', 'mov', 'webm', 'flv', 'm4v', 'avi'],
          },
        ],
      });

      return result.canceled ? undefined : result.filePaths[0];
    }),
  };
}
