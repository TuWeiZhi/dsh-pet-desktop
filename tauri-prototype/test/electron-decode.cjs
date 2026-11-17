const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const evidence = path.resolve(__dirname, '../evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'electron-decoder-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, transparent: true, webPreferences: { offscreen: true } });
    win.webContents.setBackgroundThrottling(false);
    await win.loadFile(path.resolve(__dirname, '../shell/index.html'));
    const src = pathToFileURL(path.resolve(__dirname, '../../assets/webm/待机呼吸休闲.webm')).href;
    const png = await win.webContents.executeJavaScript(`(async()=>{
      const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(src)};
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;video.load()});
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext('2d').drawImage(video,0,0);return canvas.toDataURL('image/png');
    })()`);
    fs.writeFileSync(path.join(evidence, 'idle-decoded-electron.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('Electron reference decoded.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
