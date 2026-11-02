'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

class NoteStore {
  constructor(directory) {
    this.directory = directory;
    this.queues = new Map();
    this.writeFailures = new Map();
  }

  file(key) {
    if (typeof key !== 'string' || !key) throw new Error('Invalid note key');
    return path.join(this.directory, createHash('sha256').update(key).digest('hex') + '.txt');
  }

  serial(key, operation) {
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.queues.set(key, next);
    // 调用方仍收到拒绝；此处防止退出前检查队列时出现未处理拒绝。
    void next.catch(() => {});
    return next;
  }

  async replace(file, text) {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(file + '.tmp', text, 'utf8');
      await fs.rename(file + '.tmp', file);
      this.writeFailures.delete(file);
    } catch (error) {
      this.writeFailures.set(file, error);
      throw error;
    }
  }

  read(key, legacy) {
    const file = this.file(key);
    return this.serial(key, async () => {
      try { return await fs.readFile(file, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (typeof legacy !== 'string') return null;
      // 仅在新文件不存在时迁移；空字符串也是已保存内容，不能被旧副本复活。
      await this.replace(file, legacy);
      return legacy;
    });
  }

  write(key, text) {
    const file = this.file(key);
    if (typeof text !== 'string') throw new Error('Invalid note text');
    return this.serial(key, () => this.replace(file, text));
  }

  async flush() {
    await Promise.allSettled(this.queues.values());
    if (this.writeFailures.size) throw this.writeFailures.values().next().value;
  }
}

function registerNoteStorage(ipcMain, directory, getWindows) {
  const store = new NoteStore(directory);
  const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
  const check = event => {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('?')[0] !== page) {
      throw new Error('Notes are only available to the pet window');
    }
  };
  ipcMain.handle('pet:note-read', (event, key, legacy) => { check(event); return store.read(key, legacy); });
  ipcMain.handle('pet:note-write', (event, key, text) => { check(event); return store.write(key, text); });
  ipcMain.handle('pet:notes-flush', event => { check(event); return flushNoteWindows(getWindows(), store); });
  ipcMain.handle('pet:notes-resume', event => { check(event); return resumeNoteWindows(getWindows()); });
  // 页面关闭/刷新时交接最后一份草稿，主进程可在 renderer 销毁后继续写入。
  ipcMain.on('pet:note-queue', (event, key, text) => {
    try {
      check(event);
      void store.write(key, text).catch(error => console.error('[dsh-pet] 便签离页保存失败', error));
    } catch (error) { console.error('[dsh-pet] 便签离页请求失败', error); }
  });
  return store;
}

async function flushNoteWindows(windows, store) {
  const live = windows.filter(win => !win.isDestroyed());
  try {
    await Promise.all(live.map(win =>
      win.webContents.executeJavaScript('window.PetNotes ? window.PetNotes.flushAll(true) : undefined')));
    await store.flush();
  } catch (error) {
    await resumeNoteWindows(live);
    throw error;
  }
}

async function resumeNoteWindows(windows) {
  await Promise.allSettled(windows.filter(win => !win.isDestroyed()).map(win =>
    win.webContents.executeJavaScript('window.PetNotes && window.PetNotes.resumeEditing()')));
}

function noteQuitGuard(app, getWindows, store, onError) {
  let ready = false;
  let pending = false;
  return event => {
    if (ready) return false;
    event.preventDefault();
    if (!pending) {
      pending = true;
      void flushNoteWindows(getWindows(), store).then(() => {
        ready = true;
        app.quit();
      }).catch(error => { pending = false; onError(error); });
    }
    return true;
  };
}

module.exports = { NoteStore, registerNoteStorage, flushNoteWindows, resumeNoteWindows, noteQuitGuard };
