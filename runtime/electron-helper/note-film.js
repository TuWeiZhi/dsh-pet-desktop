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
    this.generation = 0;
    this.lastTime = null;
    this.transitionStart = null;
    this.blending = false;
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
    this.previous = document.createElement('canvas');
    this.previous.width = this.canvas.width;
    this.previous.height = this.canvas.height;
    this.previousContext = this.previous.getContext('2d');
    this.transitionDuration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 0 : window.PetNoteMedia.transitionDuration;
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
    return this.size / window.PetNoteMedia.width;
  }

  getCard() {
    const { paper } = window.PetNoteMedia;
    const scale = this.scale();
    return {
      x: paper.x * scale,
      y: paper.y * scale,
      w: paper.w * scale,
      h: paper.h * scale,
    };
  }

  snapshot() {
    this.previousContext.clearRect(0, 0, this.previous.width, this.previous.height);
    this.previousContext.drawImage(this.canvas, 0, 0);
    this.blending = this.transitionDuration > 0;
    this.transitionStart = null;
  }

  drawRestingVideo() {
    this.context.save();
    // drawImage reads raw video pixels, not the CSS facing of the visible pet.
    if (this.restingVideo.style.transform === 'scaleX(-1)') {
      this.context.translate(640 + this.size, 0);
      this.context.scale(-1, 1);
    }
    this.context.drawImage(this.restingVideo, 320, 320, this.size, this.size * 9 / 16);
    this.context.restore();
  }

  setClip(name, restingVideo) {
    this.stop();
    this.restingVideo = restingVideo;
    if (this.canvas.hidden && restingVideo?.readyState >= 2) {
      this.context.clearRect(0, 0, this.width, this.height);
      this.drawRestingVideo();
      this.snapshot();
    } else if (!this.canvas.hidden) this.snapshot();
    this.clip = name;
    this.lastTime = null;
    // Retain the last rendered frame until the next video has decoded.
  }

  schedule() {
    if (!this.clip || this.frameRequest !== null) return;
    const generation = this.generation;
    this.frameRequest = this.video.requestVideoFrameCallback((_, frame) => {
      if (generation !== this.generation) return;
      this.frameRequest = null;
      this.draw(frame.mediaTime);
      if (generation === this.generation) this.schedule();
    });
  }

  draw(time) {
    if (this.video.readyState < 2 || !this.clip) return;
    const media = window.PetNoteMedia;
    // A looping clip needs the same seam treatment as a change of source.
    if (this.lastTime !== null && time < this.lastTime) this.snapshot();
    this.lastTime = time;
    let amount = 1;
    if (this.clip === '拿出') amount = Math.min(1, time);
    if (this.clip === '收起') amount = Math.max(0, Math.min(1, (media.closeEnd - time) / .5));
    amount = amount * amount * (3 - 2 * amount);
    const scale = this.scale();
    const offset = this.getOffset();
    const x = 320 + offset.x * amount;
    const y = 320 + offset.y * amount;
    this.context.clearRect(0, 0, this.width, this.height);
    if (this.blending) {
      if (this.transitionStart === null) this.transitionStart = time;
      const progress = Math.min(1, (time - this.transitionStart) / this.video.playbackRate / this.transitionDuration);
      this.blending = progress < 1;
      if (this.blending) {
        const weight = progress * progress * (3 - 2 * progress);
        this.context.globalAlpha = 1 - weight;
        this.context.drawImage(this.previous, 0, 0, this.width, this.height);
        // Add premultiplied weights so opaque paper stays opaque during a blend.
        this.context.globalCompositeOperation = 'lighter';
        this.context.globalAlpha = weight;
      }
    }
    this.context.drawImage(this.video, x, y, media.width * scale, media.height * scale);
    this.context.globalAlpha = 1;
    this.context.globalCompositeOperation = 'source-over';
    if (this.clip === '收起' && this.restingVideo?.readyState >= 2 && this.transitionDuration > 0) {
      const duration = this.transitionDuration * this.video.playbackRate;
      const progress = Math.max(0, Math.min(1, (time - media.closeEnd + duration) / duration));
      if (progress > 0) {
        if (progress === 1) {
          // Match the normal renderer exactly at the handoff, including edges.
          this.context.clearRect(0, 0, this.width, this.height);
        } else {
          this.context.globalCompositeOperation = 'destination-in';
          this.context.globalAlpha = 1 - progress;
          this.context.fillRect(0, 0, this.width, this.height);
          this.context.globalCompositeOperation = 'lighter';
          this.context.globalAlpha = progress;
        }
        this.drawRestingVideo();
        this.context.globalAlpha = 1;
        this.context.globalCompositeOperation = 'source-over';
      }
    }
    this.canvas.hidden = false;
    this.onFrame(this.clip, time);
  }

  stop() {
    this.generation++;
    if (this.frameRequest !== null) this.video.cancelVideoFrameCallback(this.frameRequest);
    this.frameRequest = null;
  }

  hide() {
    this.stop();
    this.clip = null;
    this.blending = false;
    this.lastTime = null;
    this.canvas.hidden = true;
  }

  dispose() {
    this.hide();
    this.video.removeEventListener('loadeddata', this.loaded);
    this.canvas.remove();
  }
}

window.PetNoteFilm = PetNoteFilm;
