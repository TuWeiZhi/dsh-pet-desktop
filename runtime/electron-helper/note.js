/* 桌面便签：即时编辑，合并输入后交给主进程异步保存。 */
'use strict';

const noteKey = (id) => 'dsh-pet:note:v1:' + id;
const activeNotes = new Set();

function notePlacement(anchor, bounds, body) {
  const w = Math.min(280, Math.max(0, bounds.w - 16));
  const h = Math.min(272, Math.max(0, bounds.h - 16));
  const placement = {
    x: Math.max(bounds.x + 8, Math.min(anchor.x - w / 2, bounds.x + bounds.w - w - 8)),
    y: Math.max(bounds.y + 8, Math.min(anchor.y - h + 8, bounds.y + bounds.h - h - 8)),
    w,
    h,
  };
  // 顶边放不下时优先移到身体侧面，保留宠物与便签之间的鼠标通道。
  if (body && placement.y + h > anchor.y + 8) {
    const right = body.x + body.w + 12;
    const left = body.x - w - 12;
    if (right + w <= bounds.x + bounds.w - 8) placement.x = right;
    else if (left >= bounds.x + 8) placement.x = left;
  }
  return placement;
}

class PetNote {
  constructor({ id, name, mount, getLayout, canOpen, onChange }) {
    this.id = id;
    this.getLayout = getLayout;
    this.canOpen = canOpen;
    this.onChange = onChange;
    this.isOpen = false;
    this.hovered = false;
    this.composing = false;
    this.suppressed = false;
    this.openTimer = null;
    this.closeTimer = null;
    this.ac = new AbortController();
    const options = { signal: this.ac.signal };
    this.el = document.createElement('section');
    this.el.className = 'pet-note';
    this.el.dataset.material = 'glass';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', name + '的便签');
    this.input = document.createElement('textarea');
    this.input.id = 'pet-note-text';
    this.input.setAttribute('aria-label', name + '的便签');
    this.input.className = 'pet-note-text';
    this.input.readOnly = true;
    this.input.placeholder = '有什么要记住的？\n交给大肥鱼吧。';
    this.input.spellcheck = false;
    this.status = document.createElement('span');
    this.status.className = 'pet-note-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');
    this.el.append(this.input, this.status);
    mount.appendChild(this.el);
    this.loaded = false;
    this.exiting = false;
    this.saver = new window.PetNoteSaving.NoteSaver(async text => {
      await window.petBridge.writeNote(this.id, text);
      this.setStatus('');
    }, error => this.saveFailed(error));
    this.ready = this.load();
    activeNotes.add(this);
    this.input.addEventListener('input', () => this.save(), options);
    this.input.addEventListener('compositionstart', () => {
      this.composing = true;
      this.clearTimers();
    }, options);
    this.input.addEventListener('compositionend', () => {
      this.composing = false;
      this.save();
      this.setHover(this.hovered, false);
    }, options);
    this.el.addEventListener('pointerdown', (event) => event.stopPropagation(), options);
    this.el.addEventListener('mouseenter', () => this.setHover(false, true), options);
    this.el.addEventListener('mouseleave', () => this.setHover(false, false), options);
    this.el.addEventListener('focusin', () => this.clearTimers(), options);
    this.el.addEventListener('focusout', (event) => {
      if (!this.el.contains(event.relatedTarget)) this.setHover(this.hovered, false);
    }, options);
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.stopPropagation();
        event.preventDefault();
        this.close();
      }
    }, options);
    window.addEventListener('beforeunload', () => {
      if (this.loaded && this.saver.dirty) {
        this.saver.clearTimers();
        window.petBridge.queueNote(this.id, this.input.value);
      }
    }, options);
  }

  async load() {
    try {
      let text = await window.petBridge.readNote(this.id);
      if (text === null) {
        const legacy = window.localStorage.getItem(noteKey(this.id));
        text = legacy === null ? '' : await window.petBridge.readNote(this.id, legacy);
      }
      this.input.value = text;
      this.saver.saved = text;
      this.loaded = true;
      this.input.readOnly = this.exiting;
      this.setStatus('');
    } catch (error) {
      this.setStatus('读取失败，请重新打开', true);
      // 无法读取时禁止覆盖一份可能存在的旧便签。
      this.input.readOnly = true;
      console.error('[dsh-pet] 便签读取失败', error);
    }
  }

  save() {
    if (this.loaded) this.saver.schedule(this.input.value);
  }

  saveFailed(error) {
    this.setStatus('未保存，请复制留存', true);
    console.error('[dsh-pet] 便签保存失败', error);
  }

  async flush() {
    await this.ready;
    try { await this.saver.flush(); }
    catch (error) { this.saveFailed(error); throw error; }
  }

  setStatus(text, failed = false) {
    this.status.textContent = text;
    this.status.hidden = !text;
    this.status.classList.toggle('is-error', failed);
  }

  clearTimers() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.openTimer = this.closeTimer = null;
  }

  setHover(inBody, inBoard) {
    this.hovered = inBody || inBoard;
    if (!this.hovered) this.suppressed = false;
    if (this.hovered) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
      if (!this.isOpen && !this.suppressed && this.openTimer === null && this.canOpen()) {
        this.openTimer = setTimeout(() => { this.openTimer = null; this.show(); }, 320);
      }
    } else {
      clearTimeout(this.openTimer);
      this.openTimer = null;
      if (this.isOpen && !this.composing && this.closeTimer === null) {
        this.closeTimer = setTimeout(() => this.close(), 450);
      }
    }
  }

  show(focus = false) {
    if (!this.canOpen()) return;
    this.clearTimers();
    if (!this.isOpen) {
      this.isOpen = true;
      this.suppressed = false;
      this.el.hidden = false;
      this.place();
      this.onChange(true);
    }
    if (focus) this.input.focus();
  }

  close() {
    this.clearTimers();
    // 鼠标仍在交互区时才抑制重开；编辑时已移到外部，下一次进入就应正常展开。
    this.suppressed = this.hovered;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.composing = false;
    this.el.hidden = true;
    if (this.el.contains(document.activeElement)) document.activeElement.blur();
    void this.flush().catch(() => {});
    this.onChange(false);
  }

  containsPoint(x, y) {
    if (!this.isOpen) return false;
    const rect = this.el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  place() {
    if (!this.isOpen) return;
    const { anchor, bounds, body } = this.getLayout();
    const p = notePlacement(anchor, bounds, body);
    Object.assign(this.el.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
  }

  dispose() {
    const saved = this.flush();
    this.clearTimers();
    this.ac.abort();
    this.el.remove();
    activeNotes.delete(this);
    return saved;
  }
}

function resumeNoteEditing() {
  for (const note of activeNotes) {
    note.exiting = false;
    note.input.readOnly = !note.loaded;
  }
}

async function flushAllNotes(lock = false) {
  const notes = [...activeNotes];
  if (lock) for (const note of notes) {
    if (note.el.contains(document.activeElement)) document.activeElement.blur();
    note.exiting = true;
    note.input.readOnly = true;
  }
  try { await Promise.all(notes.map(note => note.flush())); }
  catch (error) { if (lock) resumeNoteEditing(); throw error; }
}

if (typeof module !== 'undefined') module.exports = { PetNote, notePlacement };
else window.PetNotes = { PetNote, flushAll: flushAllNotes, resumeEditing: resumeNoteEditing };
