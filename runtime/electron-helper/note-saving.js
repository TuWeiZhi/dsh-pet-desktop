'use strict';

// 只保留最新草稿；正常停顿 400ms 合并，持续输入时每 2s 触发一次保存。
class NoteSaver {
  constructor(write, onError = () => {}) {
    this.write = write;
    this.onError = onError;
    this.pending = null;
    this.saved = null;
    this.failed = false;
    this.running = null;
    this.timer = null;
    this.deadline = null;
  }

  get dirty() { return this.pending !== null || this.running !== null; }

  schedule(text) {
    if (!this.dirty && !this.failed && text === this.saved) return;
    this.pending = text;
    clearTimeout(this.timer);
    const save = () => { void this.flush().catch(this.onError); };
    this.timer = setTimeout(save, 400);
    if (this.deadline === null) this.deadline = setTimeout(save, 2000);
  }

  clearTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.timer = this.deadline = null;
  }

  flush() {
    this.clearTimers();
    if (this.running) return this.running.then(() => this.flush());
    if (this.pending === null) return Promise.resolve();
    const text = this.pending;
    this.pending = null;
    if (!this.failed && text === this.saved) return Promise.resolve();
    this.running = Promise.resolve().then(() => this.write(text)).then(() => {
      this.saved = text;
      this.failed = false;
    }).catch(error => {
      this.failed = true;
      // 写入期间的新输入优先于失败的旧快照。
      if (this.pending === null) this.pending = text;
      throw error;
    }).finally(() => { this.running = null; });
    return this.running.then(() => this.flush());
  }
}

if (typeof module !== 'undefined') module.exports = { NoteSaver };
else window.PetNoteSaving = { NoteSaver };
