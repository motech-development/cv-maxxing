import { contextBridge, ipcRenderer } from 'electron';
import { exposeDesktopApi } from './expose-desktop-api.js';

if (process.env.VITEST !== 'true') {
  exposeDesktopApi({
    contextBridge,
    ipcRenderer,
  });
}
