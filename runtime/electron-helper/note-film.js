'use strict';

// Draw the entire decoded frame together; editable HTML adds only ink.
class PetNoteFilm {
  constructor(video, stage, size, getOffset, onFrame) {
    this.video = video;
    this.size = size;
    this.getOffset = getOffset;
    this.onFrame = onFrame;
    this.clip = null;
    this.frameRequest = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pet-note-film';
    this.canvas.hidden = true;
    this.width = size + 640;
    this.height = size * 3 / 4 + 640;
    const density = window.devicePixelRatio || 1;
    this.canvas.width = Math.ceil(this.width * density);
    this.canvas.height = Math.ceil(this.height * density);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.context = this.canvas.getContext('2d');
    this.context.scale(density, density);
    stage.appendChild(this.canvas);
    this.loaded = () => {
      if (!this.clip) return;
      // loadeddata can precede a drawable Chromium video frame. Keep the old
      // canvas until requestVideoFrameCallback supplies the first real frame.
      this.schedule();
    };
    video.addEventListener('loadeddata', this.loaded);
  }

  scale() {
    // Small pets zoom as a whole so five 18px rows remain legible.
    return Math.max(this.size / 640, 130 / window.PetNoteMedia.paper.h);
  }

  getCard() {
    const { paper } = window.PetNoteMedia;
    const scale = this.scale();
    return {
      x: this.size / 2 + (paper.x - 320) * scale,
      y: (this.size / 640 - scale) * 330 + paper.y * scale,
      w: paper.w * scale,
      h: paper.h * scale,
    };
  }

  setClip(name) {
    this.stop();
    this.clip = name;
    // Retain the last rendered frame until the next video has decoded.
  }

  schedule() {
    this.frameRequest = this.video.requestVideoFrameCallback((_, frame) => {
      this.frameRequest = null;
      this.draw(frame.mediaTime);
      this.schedule();
    });
  }

  draw(time) {
    if (this.video.readyState < 2 || !this.clip) return;
    const media = window.PetNoteMedia;
    let amount = 1;
    if (this.clip === '拿出') amount = Math.min(1, time);
    if (this.clip === '收起') amount = Math.max(0, Math.min(1, (media.closeEnd - time) / .5));
    amount = amount * amount * (3 - 2 * amount);
    const base = this.size / 640;
    const scale = base + (this.scale() - base) * amount;
    const offset = this.getOffset();
    const x = 320 + this.size / 2 - 320 * scale + offset.x * amount;
    const y = 320 + (base - scale) * 330 + offset.y * amount;
    this.context.clearRect(0, 0, this.width, this.height);
    this.context.drawImage(this.video, x, y, media.width * scale, media.height * scale);
    this.canvas.hidden = false;
    this.onFrame(this.clip, time);
  }

  stop() {
    if (this.frameRequest !== null) this.video.cancelVideoFrameCallback(this.frameRequest);
    this.frameRequest = null;
  }

  hide() {
    this.stop();
    this.clip = null;
    this.canvas.hidden = true;
  }

  dispose() {
    this.hide();
    this.video.removeEventListener('loadeddata', this.loaded);
    this.canvas.remove();
  }
}

window.PetNoteFilm = PetNoteFilm;
