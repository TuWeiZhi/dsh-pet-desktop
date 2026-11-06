'use strict';

// Split at displayed line boundaries while retaining every UTF-16 code unit of the stored text.
function paginate(text, width, measure, maxLines) {
  const pages = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let start = 0, line = 1, used = 0;
  for (const item of segmenter.segment(text)) {
    const char = item.segment;
    const offset = item.index;
    if (char === '\n' || char === '\r\n' || char === '\r') {
      line++;
      used = 0;
      if (line > maxLines) {
        pages.push({ start, end: offset + char.length, lines: maxLines });
        start = offset + char.length;
        line = 1;
      }
    } else {
      let next = measure(char, used);
      if (used > 0 && used + next > width) {
        line++;
        used = 0;
        if (line > maxLines) {
          pages.push({ start, end: offset, lines: maxLines });
          start = offset;
          line = 1;
        }
        next = measure(char, used);
      }
      used += next;
    }
  }
  pages.push({ start, end: text.length, lines: line });
  return pages;
}

function pageAt(pages, offset) {
  let low = 0, high = pages.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (pages[mid].start <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

if (typeof module !== 'undefined') module.exports = { paginate, pageAt };
else window.PetNotePages = { paginate, pageAt };
