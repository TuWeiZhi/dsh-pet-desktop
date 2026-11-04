const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// Run with: electron tools/note-smoke.cjs (after npm install); --sleep checks sleep interactions.
// Uses an isolated temporary profile and fixture server, never the user's pet data.
// Re-run with DSH_PET_NOTE_TEST_DIR=<printed directory> and --read to check a process restart.
const root = path.resolve(__dirname, '..');
const output = process.env.DSH_PET_NOTE_TEST_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dsh-pet-note-'));
console.log('Test artifacts: ' + output);
const http = require('node:http');
const vm = require('node:vm');
const fixture = vm.runInNewContext('(' + fs.readFileSync(path.join(root, 'assets/config.jsonc'), 'utf8') + ')');
fixture.pets[0].fixedEnabled = true;
fixture.pets[0].whisperEnabled = false;
fixture.pets[0].position = { corner: 'bottom-right', marginX: 500, marginY: 200 };
fixture.pets.push({ ...fixture.pets[0], id: 'note-smoke-other', name: '测试伙伴' });
let siblingKey = null;
let restartSnapshot = null;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('content-type', 'application/json');
  if (url.endsWith('/config')) return res.end(JSON.stringify({ main: fixture }));
  if (url.endsWith('/state')) return res.end(JSON.stringify({ counter: 0, sections: {}, pets: {} }));
  if (req.method === 'POST') {
    if (url.endsWith('/reload') || url.endsWith('/pet-display')) {
      restartSnapshot = siblingKey ? await noteStore.read(siblingKey) : null;
    }
    return res.end(url.endsWith('/pet-display') ? JSON.stringify({ok:false,error:'generate-error'}) : '{}');
  }
  const asset = url.replace('/dsh-pet-7340/thumb/main/', 'webm/').replace('/dsh-pet-7340/font/', 'fonts/').replace('/dsh-pet-7340/pic/', 'pic/');
  const file = path.resolve(root, 'assets', asset);
  if (!file.startsWith(path.join(root, 'assets') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end();
  }
  const types = { '.webm': 'video/webm', '.ttf': 'font/ttf', '.png': 'image/png' };
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const profile = path.join(output, 'electron-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.disableHardwareAcceleration();
const { registerNoteStorage, noteQuitGuard } = require('../runtime/electron-helper/note-storage.js');
const noteStore = registerNoteStorage(ipcMain, path.join(profile, 'notes'), () => BrowserWindow.getAllWindows());
let noteWrites = 0;
const writeNote = noteStore.write.bind(noteStore);
noteStore.write = (key, text) => { noteWrites++; return writeNote(key, text); };
const guardQuit = noteQuitGuard(app, () => BrowserWindow.getAllWindows(), noteStore, error => {
  console.error(error); app.exit(1);
});
app.on('before-quit', event => {
  if (!guardQuit(event)) console.log('PASS: graceful quit waited for the final asynchronous note write');
});
let regions = null;
let inputSignals = [];
ipcMain.on('pet:input-regions', (_, input) => { regions = input; });
ipcMain.on('pet:set-bounds', () => {});
ipcMain.on('pet:set-interactive', (_, value) => inputSignals.push(['interactive', value]));
ipcMain.on('pet:input-busy', (_, value) => inputSignals.push(['busy', value]));
ipcMain.on('pet:report-flight', () => {});
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const expected = '明天的三件小事\n10:00 团队例会\n下班记得买牛奶\n给阳台的植物浇水\n\n大肥鱼帮我记着。';
const quitExpected = expected + '\n退出前最后一笔';
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const configUrl = 'http://127.0.0.1:' + server.address().port + '/dsh-pet-7340/config';
  const win = new BrowserWindow({ width: 924, height: 780, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true, preload: path.join(root, 'runtime/electron-helper/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const run = (script) => win.webContents.executeJavaScript(script, true);
  const load = async () => {
    await win.loadFile(path.join(root, 'runtime/electron-helper/index.html'), { query: {
      configUrl, settingsMenu: '1', workAreaW: '1920', workAreaH: '1080',
    } });
    for (let i=0;i<100;i++) {
      if (await run('window.__dshPetDebug.configOk')) {
        await run('sprites[0].note.ready');
        assert.equal(await run('sprites[0].note.loaded'), true, 'note loaded asynchronously');
        return;
      }
      await delay(100);
    }
    throw new Error('Renderer did not boot: ' + await run('JSON.stringify(window.__dshPetDebug)'));
  };
  // Hidden windows do not consistently receive native mousemove after focus is blurred.
  // Feed the same forwarded renderer event that the production bridge supplies.
  const move = async (x,y) => { await run(`window.dispatchEvent(new MouseEvent('mousemove',{clientX:${x},clientY:${y},buttons:0}))`); await delay(30); };
  const box = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  const hover = async () => { const b=await box('.pet-hit'); await move(b.x+b.width/2,b.y+b.height/2); await delay(500); };
  const visible = () => run('sprites[0].note.isOpen');
  try {
    await load();
    if (process.argv.includes('--pages') || process.argv.length === 2) {
      await hover();
      await run('sprites[0].note.show(true)');
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      assert.equal(await run('sprites[0].notePhase'), 'idle', 'opening reaches the idle pose');
      assert.equal(await run('sprites[0].note.el.style.visibility'), '', 'editor is visible');
      assert.equal(await run('document.activeElement === sprites[0].note.input'), true, 'keyboard opening focuses after the animation');
      await run(`sprites[0].note.input.value=${JSON.stringify('一\n二\n三\n四\n五')}; sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
      assert.equal(await run('sprites[0].note.next.disabled'), false);
      await run('sprites[0].note.next.click()');
      assert.equal(await run('sprites[0].note.pageNumber.textContent'), '2');
      assert.equal(await run('sprites[0].notePhase'), 'page');
      assert.equal(await run('getComputedStyle(sprites[0].note.el).backgroundColor'), 'rgba(0, 0, 0, 0)', 'the fixed card must not cover the turning video');
      assert.equal(await run('getComputedStyle(sprites[0].note.input).visibility'), 'hidden', 'text must not float over the turning page');
      assert.equal(await run('getComputedStyle(sprites[0].note.prev).visibility'), 'visible', 'navigation stays available during the turn');
      await run(`sprites[0].note.input.value='第二页'; sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
      await run('sprites[0].note.flush()');
      assert.equal(await noteStore.read(await run('sprites[0].note.id')), '一\n二\n三\n四\n五\n第二页');
      await run(`sprites[0].note.input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));sprites[0].note.input.value='第二页和组词';`);
      await run('sprites[0].note.flush()');
      await run(`sprites[0].note.input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
      await run('sprites[0].note.flush()');
      assert.equal(await noteStore.read(await run('sprites[0].note.id')), '一\n二\n三\n四\n五\n第二页和组词');
      for (let i=0; i<100 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      await run('sprites[0].note.prev.click()');
      assert.equal(await run('sprites[0].note.pageNumber.textContent'), '1');
      assert.equal(await run('sprites[0].note.input.value'), '一\n二\n三\n四\n五\n');
      assert.equal(await run('sprites[0].note.isOpen && !sprites[0].note.el.hidden'), true, 'note remains visible during page changes');
      win.webContents.invalidate();
      await delay(250);
      fs.writeFileSync(path.join(output, 'pages-preview.png'), (await win.webContents.capturePage({stayHidden:true,stayAwake:true})).toPNG());
      await load();
      assert.equal(await run('sprites[0].note.text'), '一\n二\n三\n四\n五\n第二页和组词', 'saved text survives reload');
      await run('sprites[0].note.show()');
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      const layoutCheck = await run(`(() => {
        const n = sprites[0].note;
        const inputs = ['连续中文与English text 12345 '.repeat(40), 'a\t'.repeat(50), 'word\t'.repeat(40), '😀é'.repeat(60)];
        return inputs.map(text => {
          n.text = text;
          n.repaginate(0);
          const lengths = [];
          for (let p=0; p<n.pages.length; p++) { n.page=p; n.renderPage(); lengths.push([n.input.scrollHeight,n.input.clientHeight]); }
          return {lengths, text:n.text, font:n.measureContext.font, css:getComputedStyle(n.input).font};
        });
      })()`);
      assert.equal(layoutCheck[0].text, '连续中文与English text 12345 '.repeat(40));
      assert.ok(layoutCheck.every(item => item.lengths.every(([scroll, client]) => scroll <= client + 1)), 'each page fits within five displayed rows: '+JSON.stringify(layoutCheck));
      const waitForNoteIdle = async () => {
        for (let i=0; i<150 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
        assert.equal(await run('sprites[0].notePhase'), 'idle');
        assert.equal(await run('sprites[0].note.pageTurning'), false);
      };
      await run(`(() => {
        const pet = sprites[0], n = pet.note;
        n.text = Array.from({length:21}, (_, i) => 'line ' + i).join('\\n');
        n.repaginate(0);
        window.noteTurnClips = [];
        window.noteTurnDurations = [];
        window.originalNoteClip = pet.playNoteClip.bind(pet);
        pet.playNoteClip = (name, loop, done) => {
          const turning = name === '上一页' || name === '下一页';
          if (turning) window.noteTurnClips.push(name);
          const start = performance.now();
          window.originalNoteClip(name, loop, () => {
            if (turning) window.noteTurnDurations.push(performance.now() - start);
            if (done) done();
          });
        };
        n.next.click(); n.next.click(); n.next.click();
      })()`);
      assert.equal(await run('sprites[0].note.page'), 1, 'rapid clicks do not jump ahead of the animation');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 4);
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 3);
      assert.deepEqual(await run('window.noteTurnClips'), ['下一页', '下一页', '下一页']);
      const turnDurations = await run('window.noteTurnDurations');
      assert.ok(turnDurations.every(ms => ms >= 800 && ms < 1500), 'page turns should take about one second including media load: ' + turnDurations);
      console.log('Page-turn elapsed ms: ' + turnDurations.map(Math.round).join(', '));
      assert.equal(await run('getComputedStyle(sprites[0].note.input).visibility'), 'visible');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 1);
      await run('window.noteTurnClips = []; sprites[0].note.prev.click(); sprites[0].note.prev.click()');
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 1);
      assert.deepEqual(await run('window.noteTurnClips'), ['上一页', '上一页']);
      await run('window.noteTurnClips = []; sprites[0].note.next.click(); sprites[0].note.next.click(); sprites[0].note.close(); sprites[0].note.show(true)');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 2);
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 2, 'closing discards the queued page request');
      assert.deepEqual(await run('window.noteTurnClips'), ['下一页']);
      await run('sprites[0].playNoteClip = window.originalNoteClip; void 0');
      await run('sprites[0].note.close()');
      assert.equal(await run('sprites[0].notePhase'), 'closing');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 2);
      await run(`sprites[0].onMenuAction({anim:'哈欠连天'})`);
      assert.equal(await run('sprites[0].notePhase'), null, 'a requested action cancels the closing animation');
      await delay(5500);
      assert.equal(await run('sprites[0].anim'), '哈欠连天', 'closing cannot override the newer action');
      console.log('PASS: opening, five lines, unobscured fast page changes, rapid forward/back navigation, close/reopen and text preservation');
      console.log('Screenshot: ' + path.join(output, 'pages-preview.png'));
      app.exit(0); return;
    }
    if (process.argv.includes('--sleep')) {
      await run(`sprites[0].hit.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:400,clientY:260}))`);
      assert.ok((await run('document.querySelector(".dsh-pet-menu").textContent')).includes('睡觉'));
      await run(`Array.from(document.querySelectorAll('.dsh-pet-menu-item')).find(e => e.textContent.includes('睡觉')).click()`);
      assert.equal(await run('sprites[0].sleepPhase'), 'start');
      for (let i = 0; i < 200 && await run('sprites[0].sleepPhase') !== 'loop'; i++) await delay(100);
      assert.equal(await run('sprites[0].sleepPhase'), 'loop', 'the real sleep video advances to the loop');
      for (let i=0; i<50 && !await run('(sprites[0].front === 0 ? sprites[0].videoA : sprites[0].videoB).loop'); i++) await delay(100);
      assert.equal(await run('(sprites[0].front === 0 ? sprites[0].videoA : sprites[0].videoB).loop'), true);
      await hover();
      assert.equal(await visible(), false, 'hover does not open the note while sleeping');
      await run(`sprites[0].hit.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:400,clientY:260}))`);
      assert.ok((await run('document.querySelector(".dsh-pet-menu").textContent')).includes('起来'));
      await run('sprites[0].closeMenu()');
      await run('sprites[0].hit.click()');
      assert.equal(await run('sprites[0].sleepPhase'), 'end');
      for (let i = 0; i < 200 && await run('sprites[0].sleepPhase') !== null; i++) await delay(100);
      assert.equal(await run('sprites[0].sleepPhase'), null, 'wake video returns to the normal animation chain');
      console.log('PASS: sleep menu, video playback, note suppression and click to wake');
      app.exit(0); return;
    }
    if (process.argv.includes('--read') || process.argv.includes('--read-quit')) {
      assert.equal(await run('sprites[0].note.input.value'), process.argv.includes('--read-quit') ? quitExpected : expected);
      console.log('PASS: memo persisted across Electron process restart');
      app.exit(0); return;
    }
    if (process.argv.includes('--quit')) {
      await run(`sprites[0].note.input.value=${JSON.stringify(quitExpected)};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
      app.quit();
      return;
    }
    const noteId = await run('sprites[0].note.id');
    if (await noteStore.read(noteId) === null) {
      await run(`localStorage.setItem('dsh-pet:note:v1:'+sprites[0].note.id,'迁移前的便签')`);
      await load();
      assert.equal(await run('sprites[0].note.input.value'), '迁移前的便签');
      assert.equal(await noteStore.read(noteId), '迁移前的便签');
    }
    assert.equal(await run('sprites[0].note.input.maxLength'), -1, 'no character cap');
    await hover();
    assert.equal(await visible(),true,'hover opens note');
    assert.equal(await run('document.querySelector(".pet-note-head, .pet-note-close")'),null,'note has no visible title or close button');
    assert.equal(await run('sprites[0].notePose.hidden'),false,'holding pose visible');
    const panel = await box('.pet-note');
    assert.equal(panel.width,280);
    assert.equal(panel.height,272);
    assert.ok(regions.rects.some(r => Math.abs(r.width-280)<1),'note registered with native input bridge');
    const input = await box('.pet-note-text');
    assert.ok(input.height >= 216,'at least nine visible lines');
    assert.equal(await run('document.querySelector(".pet-note").innerText.includes("字符")'),false,'no character counter');
    assert.equal(await run('(()=>{const r=sprites[0].note.input.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.bottom-4)===sprites[0].note.input})()'),true,'editable text is in front of the overlapping head');
    await move(input.x+30,input.y+30);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(input.x+30),y:Math.round(input.y+30)});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(input.x+30),y:Math.round(input.y+30)});
    await delay(50);
    assert.equal(await run('document.activeElement.id'),'pet-note-text','click focuses textarea');
    await run('sprites[0].note.input.select()');
    await win.webContents.insertText(expected);
    assert.equal(await run('sprites[0].note.input.value'),expected);
    assert.equal(await run('sprites[0].dragState.active'),false,'typing does not start drag');
    await move(20,20); await delay(600);
    assert.equal(await visible(),false,'leaving closes even a focused note');
    assert.equal(await run('sprites[0].note.input.value'),expected,'leaving preserves edited text');
    await hover();
    await run('sprites[0].note.input.focus()');
    await run('sprites[0].note.input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))');
    await move(20,20); await delay(600);
    assert.equal(await visible(),true,'an unfinished IME composition is not interrupted');
    await run('sprites[0].note.input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"记"}))');
    await delay(600);
    assert.equal(await visible(),false,'closes after IME composition finishes outside');
    await hover();
    await run('sprites[0].note.input.focus()');
    await run(`sprites[0].note.input.value=${JSON.stringify('滚动测试\n'.repeat(80))};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await run('sprites[0].note.input.scrollHeight>sprites[0].note.input.clientHeight'),true,'long text scrolls');
    assert.equal((await box('.pet-note')).height,272,'long text does not grow panel');
    await run(`sprites[0].note.input.value=${JSON.stringify(expected)};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await delay(80);
    assert.equal(await visible(),false,'Escape closes note');
    await move(20,20); await hover();
    assert.equal(await visible(),true,'can reopen after Escape: '+await run('JSON.stringify({hovered:sprites[0].note.hovered,suppressed:sprites[0].note.suppressed,canOpen:sprites[0].note.canOpen(),timer:sprites[0].note.openTimer,hit:sprites[0].hit.getBoundingClientRect().toJSON()})'));
    await move(20,20); await delay(600);
    assert.equal(await visible(),false,'unfocused note closes after leaving');
    await run('sprites[0].note.flush()');
    noteWrites = 0;
    const timing = await run(`(() => {
      const text = '长便签内容\\n'.repeat(20000);
      const start = performance.now();
      for (let i=0;i<30;i++) {
        sprites[0].note.input.value = text + i;
        sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      return {chars:sprites[0].note.input.value.length,inputMs:performance.now()-start};
    })()`);
    assert.equal(noteWrites, 0, 'typing does not perform an immediate disk write');
    await delay(650);
    await run('sprites[0].note.flush()');
    assert.equal(noteWrites, 1, '30 long-text input events coalesce into one asynchronous write');
    assert.equal((await noteStore.read(noteId)).length, timing.chars);
    console.log('Long note benchmark: '+JSON.stringify({...timing,inputEvents:30,writes:noteWrites}));
    // Reload before the 400ms debounce fires: beforeunload must hand the last draft to main.
    await run(`sprites[0].note.input.value=${JSON.stringify(expected)};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
    await load();
    assert.equal(await run('sprites[0].note.input.value'),expected,'reload restores memo');
    assert.equal(await run(`localStorage.getItem('dsh-pet:note:v1:'+sprites[0].note.id)`), '迁移前的便签', 'original migration backup remains untouched');
    const sibling = new BrowserWindow({show:false,webPreferences:{offscreen:true,preload:path.join(root,'runtime/electron-helper/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
    const siblingRun = script => sibling.webContents.executeJavaScript(script, true);
    await sibling.loadFile(path.join(root,'runtime/electron-helper/index.html'), {query:{configUrl,petIndex:'1',settingsMenu:'1',workAreaW:'1920',workAreaH:'1080'}});
    for (let i=0;i<100;i++) {
      if (await siblingRun('window.__dshPetDebug.configOk')) break;
      await delay(50);
    }
    await siblingRun('sprites[0].note.ready');
    siblingKey = await siblingRun('sprites[0].note.id');
    const siblingDraft = '第二个窗口等待保存 ' + Date.now();
    await siblingRun(`sprites[0].note.input.value=${JSON.stringify(siblingDraft)};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
    await run('sprites[0].reloadDesktop()');
    assert.equal(restartSnapshot, siblingDraft, 'reload waits for the OTHER renderer before sending POST');
    await run('window.petBridge.resumeNotes()');
    await siblingRun(`sprites[0].note.input.value=${JSON.stringify(siblingDraft+'-display')};sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
    await run('sprites[0].setPetDisplay("none")');
    assert.equal(restartSnapshot, siblingDraft+'-display', 'display change flushes all renderers');
    assert.equal(await run('sprites[0].note.input.readOnly'),false,'HTTP 200 business failure restores initiating editor');
    assert.equal(await siblingRun('sprites[0].note.input.readOnly'),false,'HTTP 200 business failure restores OTHER editor');
    sibling.destroy();
    console.log('PASS: all-window restart flush and HTTP 200 business-failure unlock');
    await run('sprites[0].onMenuAction({action:"note"})');
    assert.equal(await visible(),true,'menu opens note');
    await run('sprites[0].setInteractive(true)');
    await delay(50);
    inputSignals = [];
    await run('sprites[0].onPointerDown({button:0,pointerId:1,screenX:500,screenY:400,clientX:400,clientY:350})');
    await delay(50);
    assert.equal(inputSignals.some(([kind,value]) => kind === 'interactive' && value === false), false, 'note-to-drag must never release native input: '+JSON.stringify(inputSignals));
    assert.equal(await run('sprites[0].dragState.active'),true);
    await run('sprites[0].onPointerUp({clientX:400,clientY:350,screenX:500,screenY:400})');
    await run('sprites[0].note.show(true); sprites[0].note.input.scrollTop=0');
    assert.ok(await run('sprites[0].notePose.complete && sprites[0].notePose.naturalWidth > 0'), 'holding sprite loaded');
    win.webContents.invalidate();
    await delay(500);
    assert.equal(await visible(),true,'note visible for screenshot');
    console.log('Visible CSS: '+await run('JSON.stringify({panel:getComputedStyle(sprites[0].note.el).display,pose:getComputedStyle(sprites[0].notePose).display,width:sprites[0].notePose.naturalWidth})'));
    fs.writeFileSync(path.join(output,'preview.png'),(await win.webContents.capturePage({x:250,y:110,width:420,height:500}, {stayHidden:true,stayAwake:true})).toPNG());
    if (process.argv.includes('--variants')) {
      // Same production DOM and sprite on the same illustrative backdrop: only material changes.
      await run(`document.body.style.background='repeating-linear-gradient(135deg,#dce6f3 0px,#dce6f3 100px,#c5d4e9 100px,#c5d4e9 200px,#edf1f9 200px,#edf1f9 300px)'`);
      const variants = [
        ['frost', 'A · 雾蓝磨砂', '推荐：柔和、清晰，呼应蓝发与白色围裙'],
        ['glass', 'B · 通透玻璃', '更轻盈，背景透出更明显'],
        ['paper', 'C · 淡紫纸卡', '偏插画风，颜色最稳定'],
      ];
      for (const [material] of variants) {
        await run(`sprites[0].note.el.dataset.material=${JSON.stringify(material)}`);
        win.webContents.invalidate();
        await delay(250);
        fs.writeFileSync(path.join(output, `material-${material}.png`), (await win.webContents.capturePage({x:282,y:110,width:360,height:500}, {stayHidden:true,stayAwake:true})).toPNG());
      }
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>双手举牌 · 材质对比</title><style>
        *{box-sizing:border-box}body{margin:0;padding:32px;background:#f3f5f9;color:#283951;font-family:'Microsoft YaHei UI','Segoe UI',sans-serif}h1{font-size:25px;margin:0 0 10px}p{font-size:13px;color:#64748b;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(3,360px);gap:20px}article{background:#fff;border:1px solid #e0e6ef;border-radius:18px;overflow:hidden}img{display:block;width:100%;height:420px;object-fit:cover}h2{font-size:17px;margin:18px 18px 8px}article p{font-size:12px;margin:0 18px 20px}.foot{margin-top:20px;font-size:12px;color:#6e7d91}
        </style><h1>双手托举 · 三种材质</h1><p>短手自然抬起，保留完整表情。无标题、无关闭按钮，鼠标移走后自动收起。</p><div class="grid">${variants.map(([key,title,description])=>`<article><img src="material-${key}.png"><h2>${title}</h2><p>${description}</p></article>`).join('')}</div><div class="foot">相同示意背景与实际组件渲染 · 磨砂为雾面观感，不模糊其它桌面窗口</div></html>`;
      fs.writeFileSync(path.join(output, 'comparison.html'), html);
      const comparison = new BrowserWindow({width:1184,height:784,show:false,webPreferences:{offscreen:true}});
      await comparison.loadFile(path.join(output, 'comparison.html'));
      await comparison.webContents.executeJavaScript('Promise.all(Array.from(document.images, image => image.decode()))');
      comparison.webContents.invalidate();
      await delay(250);
      fs.writeFileSync(path.join(output, 'comparison.png'), (await comparison.webContents.capturePage()).toPNG());
      comparison.destroy();
      await run(`document.body.style.background='transparent';sprites[0].note.el.dataset.material='glass'`);
    }
    const defaults = await run('JSON.parse(JSON.stringify(sprites[0].pet))');
    await run(`(async()=>{await sprites[0].dispose();sprites=[new PetSprite({...${JSON.stringify(defaults)},size:120})];await sprites[0].note.ready;sprites[0].note.show()})()`);
    const small = await box('.pet-note');
    assert.ok(small.width>180 && small.width<=280,'small pet retains readable memo');
    assert.equal(await run('window.__dshPetDebug.errors.length'),0,'no renderer errors');
    console.log('PASS: hover, pose, input regions, click editing, typing, bounded scrolling, pointer exit, IME completion, Escape, leave/reopen, reload, menu, note-to-drag IPC ordering, small pet');
    console.log('Screenshot: '+path.join(output,'preview.png'));
    app.exit(0);
  } catch(error) {
    console.error(error.stack);
    console.error(await run('JSON.stringify(window.__dshPetDebug)'));
    fs.writeFileSync(path.join(output,'failed.png'),(await win.webContents.capturePage()).toPNG());
    app.exit(1);
  }
});
