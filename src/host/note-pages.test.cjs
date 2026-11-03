const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paginate, pageAt } = require('../../runtime/electron-helper/note-pages.js');
const measure = () => 1;

test('five visual rows per page preserve the original text exactly', () => {
  for (const text of ['一二三四五六七八九十甲乙丙', 'a\nb\nc\nd\ne\nf\ng', '😀e\u0301'.repeat(20), 'first\n\nlast\n']) {
    const pages = paginate(text, 2, measure);
    assert.equal(pages.map(p => text.slice(p.start, p.end)).join(''), text);
    assert.ok(pages.every(p => p.lines <= 5));
    assert.equal(pages[0].start, 0);
    assert.equal(pages.at(-1).end, text.length);
  }
});

test('a newline after the fifth row starts an empty next page', () => {
  const text = 'a\nb\nc\nd\ne\n';
  const pages = paginate(text, 10, measure);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].start, text.length);
  assert.equal(pageAt(pages, text.length), 1);
});

test('page lookup selects the next page at its boundary', () => {
  const pages = paginate('abcdefghijk', 1, measure);
  assert.equal(pageAt(pages, 0), 0);
  assert.equal(pageAt(pages, 5), 1);
  assert.equal(pageAt(pages, 11), 2);
});
