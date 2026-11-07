'use strict';

// Full-frame VP9 alpha clips prepared by tools/prepare-note-videos.py.
// Coordinates describe the actual settled paper, not a replacement card.
window.PetNoteMedia = {
  width: 640,
  height: 480,
  fps: 24,
  paper: { x: 167, y: 248, w: 306, h: 155 },
  transitionDuration: .18,
  openingTransitionDuration: .35,
  closingTransitionDuration: .35,
  readableAt: 3.5,
  closeEnd: 5,
  playbackRates: { '拿出': 2, '待机': 1, '上一页': 4, '下一页': 4, '收起': 4 },
};
