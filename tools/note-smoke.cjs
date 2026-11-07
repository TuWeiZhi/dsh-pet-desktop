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
  const hover = async () => { const b=await box('.pet-hit'); await move(b.x+b.width/2,b.y+b.height/2); await delay(1100); };
  const visible = () => run('sprites[0].note.isOpen');
  try {
    await load();
    if (process.argv.includes('--handoff')) {
      const handoff = await run(`(async () => {
        const p = sprites[0], film = p.noteFilm;
        // Reproduce opening during the ordinary A/B fade, including a mirrored pose.
        for (const v of [p.videoA, p.videoB]) {
          v.onended = null; v.autoplay = false;
          if (v.readyState < 2) {
            v.src = p.assetBase + encodeURIComponent(p.animations.idle[0]) + '.webm';
            await new Promise((resolve, reject) => {
              v.addEventListener('loadeddata', resolve, { once: true });
              v.addEventListener('error', reject, { once: true }); v.load();
            });
          }
          v.pause(); v.style.transition = 'none';
        }
        p.front = 1;
        p.videoA.style.opacity = '.65';
        p.videoB.style.opacity = '.35';
        p.videoA.style.transform = '';
        p.videoB.style.transform = 'scaleX(-1) scaleY(.85)';
        p.videoB.style.transformOrigin = 'bottom';
        await new Promise(requestAnimationFrame);
        const expected = document.createElement('canvas');
        expected.width = film.canvas.width; expected.height = film.canvas.height;
        const ctx = expected.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
        ctx.globalAlpha = .65; ctx.drawImage(p.videoA, 320, 320, p.size, p.height);
        ctx.globalAlpha = .35; ctx.translate(320+p.size/2, 320+p.height);
        ctx.scale(-1, .85); ctx.drawImage(p.videoB, -p.size/2, -p.height, p.size, p.height);
        // Delay decoder delivery: the handoff must already hold the displayed composite.
        film.schedule = () => {};
        p.note.show();
        const before = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data;
        const captured = film.previousContext.getImageData(0, 0, expected.width, expected.height).data;
        let maxError = 0, changed = 0;
        for (let i=0; i<before.length; i++) {
          const error = Math.abs(before[i]-captured[i]);
          maxError = Math.max(maxError, error); if (error > 2) changed++;
        }
        const canvasVisible = !film.canvas.hidden;
        const ordinaryHidden = getComputedStyle(p.videoA).visibility === 'hidden';
        if (p.notePose.readyState < 2) await new Promise(resolve => p.notePose.addEventListener('loadeddata', resolve, {once:true}));
        p.notePose.pause();
        film.draw(0);
        const firstFrame = film.context.getImageData(0, 0, expected.width, expected.height).data;
        let firstFrameMaxError = 0;
        for (let i=0; i<before.length; i++) firstFrameMaxError = Math.max(firstFrameMaxError, Math.abs(before[i]-firstFrame[i]));
        film.setClip('收起', p.videoB, [p.videoA, p.videoB]);
        film.draw(0);
        film.draw(window.PetNoteMedia.closeEnd);
        const closing = film.context.getImageData(0, 0, expected.width, expected.height).data;
        let closingMaxError = 0;
        for (let i=0; i<before.length; i++) closingMaxError = Math.max(closingMaxError, Math.abs(before[i]-closing[i]));
        return { maxError, changed, canvasVisible, ordinaryHidden,
          firstFrameMaxError, closingMaxError,
          expected: expected.toDataURL(), captured: film.previous.toDataURL() };
      })()`);
      for (const name of ['expected', 'captured']) {
        fs.writeFileSync(path.join(output, 'handoff-'+name+'.png'), Buffer.from(handoff[name].split(',')[1], 'base64'));
      }
      console.log('Opening handoff: '+JSON.stringify({...handoff, expected:undefined, captured:undefined}));
      assert.ok(handoff.maxError <= 2, 'opening must preserve both visible layers, opacity, facing and squash');
      assert.ok(handoff.firstFrameMaxError <= 2, 'the first decoded note frame must not jump from the held composite');
      assert.ok(handoff.closingMaxError <= 2, 'closing must return to the complete ordinary composite without a pose or opacity jump');
      assert.equal(handoff.canvasVisible, true, 'snapshot must be visible while the note decoder is loading');
      assert.equal(handoff.ordinaryHidden, true, 'ordinary CSS transitions must not advance behind the snapshot');
      console.log('PASS: ordinary-animation composite survives opening and closing handoffs without a flash');
      app.exit(0); return;
    }
    if (process.argv.includes('--appearance')) {
      await run(`document.body.style.background='#e6edf3'; sprites[0].note.show(true)`);
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      const facing = await run(`(async () => {
        const p=sprites[0], film=p.noteFilm, rest=p.front===0?p.videoA:p.videoB;
        rest.pause();
        await new Promise(requestAnimationFrame);
        const expected=document.createElement('canvas'); expected.width=film.canvas.width; expected.height=film.canvas.height;
        const ctx=expected.getContext('2d'); ctx.scale(devicePixelRatio,devicePixelRatio);
        ctx.translate(640+p.size,0); ctx.scale(-1,1); ctx.drawImage(rest,320,320,p.size,p.size*9/16);
        const pixels=ctx.getImageData(0,0,expected.width,expected.height).data;
        const transform=rest.style.transform; rest.style.transform='scaleX(-1)';
        film.hide(); film.setClip('拿出',rest);
        const opening=film.previousContext.getImageData(0,0,expected.width,expected.height).data;
        if(!opening.every((v,i)=>v===pixels[i])) throw new Error('Opening snapshot lost the normal pet facing');
        film.setClip('收起',rest); film.draw(window.PetNoteMedia.closeEnd);
        const closing=film.context.getImageData(0,0,expected.width,expected.height).data;
        let maxError=0, changed=0;
        for(let i=0;i<closing.length;i++) {const error=Math.abs(closing[i]-pixels[i]);maxError=Math.max(maxError,error);if(error)changed++;}
        rest.style.transform=transform;
        return {maxError,changed,duration:film.transitionDuration,rate:film.video.playbackRate,
          ready:film.video.readyState,restReady:rest.readyState,
          expected:expected.toDataURL(),closing:film.canvas.toDataURL()};
      })()`);
      for (const name of ['expected','closing']) fs.writeFileSync(path.join(output,'facing-'+name+'.png'),Buffer.from(facing[name].split(',')[1],'base64'));
      assert.equal(facing.maxError,0,'closing preserves the normal pet facing: '+JSON.stringify({...facing,expected:undefined,closing:undefined}));
      const colors = [];
      for (const [name, time] of [['拿出',4.9], ['待机',0], ['上一页',0], ['下一页',0], ['收起',0]]) {
        const sample = await run(`(async () => {
          const p=sprites[0], v=p.notePose;
          p.noteClipToken++; p.noteFilm.setClip(${JSON.stringify(name)});
          v.pause(); v.onended=null; v.onerror=null; v.loop=false;
          v.src='../../assets/note-video/'+encodeURIComponent(${JSON.stringify(name)})+'.webm';
          await new Promise((resolve,reject)=>{v.requestVideoFrameCallback(resolve);v.addEventListener('error',reject,{once:true});v.load()});
          p.noteFilm.stop();
          if (${time}>0) await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=${time}});
          // Exercise the actual alpha composite, including the first decoded
          // frame after a source change. A load must never hard-cut the pose.
          p.noteFilm.transitionStart=null; p.noteFilm.blending=true;
          p.noteFilm.draw(${time});
          const film=p.noteFilm, before=film.previousContext.getImageData(0,0,film.canvas.width,film.canvas.height).data;
          const first=film.context.getImageData(0,0,film.canvas.width,film.canvas.height).data;
          if (!first.every((value,i)=>value===before[i])) throw new Error('Clip boundary changed before the blend');
          p.noteFilm.draw(${time}+.09*v.playbackRate);
          const mid=film.context.getImageData(0,0,film.canvas.width,film.canvas.height).data;
          p.noteFilm.draw(${time}+.3*v.playbackRate);
          const after=film.context.getImageData(0,0,film.canvas.width,film.canvas.height).data;
          let delta=0, fullDelta=0;
          for(let i=0;i<before.length;i++) {delta+=Math.abs(mid[i]-before[i]); fullDelta+=Math.abs(after[i]-before[i]);}
          if (fullDelta>100 && (delta<=0 || delta>=fullDelta)) throw new Error('Missing intermediate transition frame');
          const c=document.createElement('canvas'); c.width=640; c.height=480;
          const ctx=c.getContext('2d'); ctx.drawImage(v,0,0);
          const rgba=ctx.getImageData(230,280,180,90).data;
          return [0,1,2].map(channel=>{
            const values=[]; for(let i=channel;i<rgba.length;i+=4) values.push(rgba[i]);
            values.sort((a,b)=>a-b); return values[Math.floor(values.length/2)];
          });
        })()`);
        colors.push(sample);
        await delay(80);
        fs.writeFileSync(path.join(output, name+'.png'), (await win.webContents.capturePage()).toPNG());
      }
      console.log('Settled paper RGB: ' + JSON.stringify(colors));
      const spread = [0,1,2].map(c => Math.max(...colors.map(rgb=>rgb[c]))-Math.min(...colors.map(rgb=>rgb[c])));
      assert.ok(spread.every(value=>value<=4), 'all clips must share the writing-paper palette; RGB spread: '+spread);
      const defaults = await run('JSON.parse(JSON.stringify(sprites[0].pet))');
      for (const size of [120, 300, 462, 800]) {
        const capacity = 5;
        const previewWidth = Math.max(924, size * 2);
        win.setSize(previewWidth, Math.max(780, Math.ceil(size * 1.5 + 300)));
        await run(`(async()=>{await sprites[0].dispose();sprites=[new PetSprite({...${JSON.stringify(defaults)},size:${size}})];await sprites[0].note.ready;sprites[0].note.show(true)})()`);
        for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
        const layout = await run(`(() => {
          const p=sprites[0], n=p.note;
          n.text='今天把手头的工作完成\\n午休整理一下项目笔记\\n下班顺路买一盒牛奶\\n晚上抽空给植物浇水\\n睡前放下手机早点休息'; n.repaginate(0); n.clearTimers();
          const style=getComputedStyle(n.input);
          return {scale:p.noteFilm.scale(), lines:n.pageLines, fontSize:parseFloat(style.fontSize), lineHeight:parseFloat(style.lineHeight),
            height:n.input.clientHeight, scroll:n.input.scrollHeight, background:getComputedStyle(n.el).backgroundColor,
            card:n.el.getBoundingClientRect().toJSON(), paper:p.noteFilm.getCard(),
            input:n.input.getBoundingClientRect().toJSON(), controls:n.controls.getBoundingClientRect().toJSON()};
        })()`);
        assert.equal(layout.scale, size/640, 'note animations never enlarge the character');
        assert.equal(layout.lines, capacity, 'every pet size has five writing rows');
        assert.ok(Math.abs(layout.fontSize/layout.card.height-.138)<.001, 'font size scales in proportion to the paper');
        assert.ok(Math.abs(layout.lineHeight*5/layout.card.height-.9)<.002, 'five rows fill the writing area');
        assert.equal(layout.background, 'rgba(0, 0, 0, 0)');
        assert.ok(Math.abs(layout.card.width-layout.paper.w)<.05 && Math.abs(layout.card.height-layout.paper.h)<.05, 'the editor stays on the proportional source paper');
        assert.ok(layout.scroll<=layout.height+1, 'all five text rows fit');
        assert.ok(layout.input.top>=layout.card.top && layout.input.bottom<=layout.card.bottom, 'writing stays inside the paper');
        assert.ok(layout.controls.top>=layout.card.bottom-.05, 'navigation does not consume writing rows');
        assert.ok(layout.card.x>=0 && layout.card.right<=previewWidth, 'editor remains on screen');
        await delay(100);
        fs.writeFileSync(path.join(output, 'size-'+size+'.png'), (await win.webContents.capturePage()).toPNG());
        if (size === 462) {
          await run("document.body.style.background='#20252b'");
          await delay(100);
          fs.writeFileSync(path.join(output, 'dark-paper.png'), (await win.webContents.capturePage()).toPNG());
          await run("document.body.style.background='#e6edf3'");
        }
        const button = await box('.pet-note-next');
        const x = button.x+button.width/2, y = button.y+button.height/2;
        await move(x,y);
        await delay(500);
        assert.equal(await visible(),true,'hovering footer navigation keeps the paper open');
        assert.ok(regions.rects.some(r=>x>=r.x && x<=r.x+r.width && y>=r.y && y<=r.y+r.height), 'footer buttons are registered for native input');
        win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(x),y:Math.round(y)});
        win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(x),y:Math.round(y)});
        await delay(100);
        assert.equal(await run('sprites[0].note.page'),1,'native footer click creates the next page');
        assert.equal(await run('sprites[0].note.next.disabled'),true,'a blank page cannot generate extra blank pages');
        console.log('Size '+size+': 5 rows at '+layout.fontSize.toFixed(2)+'px, proportional text and native footer click passed');
      }
      console.log('PASS: consistent paper color, proportional paper and text, five full writing rows');
      app.exit(0); return;
    }
    if (process.argv.includes('--film')) {
      await run(`document.body.style.background='#e6edf3'; sprites[0].note.show(true)`);
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      await run(`(() => {
        const p = sprites[0], n = p.note;
        n.text='今天要记住的事\\n10:00 参加团队例会\\n午休后整理项目笔记\\n下班顺路买一盒牛奶\\n晚上给阳台植物浇水\\n第二页的第一件事\\n继续保留原来的动作\\n文字仍然可以直接编辑\\n纸张与文字区域一致\\n翻页后内容不会丢失';
        n.repaginate(0); n.clearTimers(); p.notePose.pause(); p.noteFilm.stop();
      })()`);
      const crop = await run(`(() => {
        const p=sprites[0];
        return {x:Math.round(p.margin.l+p.size/2-250), y:Math.round(p.margin.t+p.bottomPad-25), width:500, height:390};
      })()`);
      const frameDir = path.join(output, 'film-frames');
      fs.mkdirSync(frameDir, {recursive:true});
      // A decoded video frame does not mean capturePage's cached compositor
      // snapshot is current. Wait for layout/paint, then use the paint image.
      const captureFilmFrame = async () => {
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        return new Promise((resolve, reject) => {
          const painted = (_, dirty, image) => {
            clearTimeout(timer);
            resolve(image.crop(crop).toPNG());
          };
          const timer = setTimeout(() => {
            win.webContents.removeListener('paint', painted);
            reject(new Error('Timed out waiting for a fresh preview frame'));
          }, 5000);
          win.webContents.once('paint', painted);
          win.webContents.invalidate();
        });
      };
      const sourceClips = JSON.parse(fs.readFileSync(path.join(root, 'assets/note-video/sources.json'), 'utf8')).clips;
      const playbackRates = await run('window.PetNoteMedia.playbackRates');
      const previewFps = 24 * Math.max(...Object.values(playbackRates));
      let repeatedFrames = 0;
      let capturedFrames = 0;
      let number = 0;
      for (const [name, duration] of [['拿出'],['待机'],['下一页'],['待机',.8],['上一页'],['待机',.8],['收起']]) {
        await run(`(async () => {
          const p=sprites[0], v=p.notePose, n=p.note;
          p.notePhase=${JSON.stringify(name === '待机' ? 'idle' : 'page')};
          p.noteClipToken++; p.noteFilm.setClip(${JSON.stringify(name)});
          v.pause(); v.onended=null; v.onerror=null; v.loop=false;
          v.src='../../assets/note-video/'+encodeURIComponent(${JSON.stringify(name)})+'.webm';
          await new Promise((resolve,reject)=>{v.requestVideoFrameCallback(resolve);v.addEventListener('error',reject,{once:true});v.load()});
          p.noteFilm.stop();
          n.el.style.visibility=${JSON.stringify(name === '待机' ? '' : 'hidden')};
          if (${JSON.stringify(name)} === '下一页') n.page=1;
          if (${JSON.stringify(name)} === '上一页') n.page=0;
          n.renderPage();
        })()`);
        let previousFrame = null;
        const count = duration ? Math.round(duration * 24) : sourceClips[name].frames;
        for (let frame = 0; frame < count; frame++) {
          // Sample within each frame, away from WebM's rounded millisecond PTS.
          const t = (frame + .5) / 24;
          await run(`(async () => {
            const p=sprites[0],v=p.notePose;
            // A queued video-frame callback can arrive before the new seek
            // completes, leaving readyState < 2 and the canvas unchanged.
            if (Math.abs(v.currentTime-${t})>.001) await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=${t}});
            if (v.readyState < 2 || v.seeking) throw new Error('Preview frame has not decoded');
            p.noteFilm.draw(${t});
            if (${JSON.stringify(name)}==='拿出' && ${t}>=3.5) p.revealNote();
          })()`);
          const png = await captureFilmFrame();
          if (previousFrame && png.equals(previousFrame)) repeatedFrames++;
          previousFrame = png;
          capturedFrames++;
          // The output rate preserves every source frame at the fastest speed;
          // slower clips repeat frames to keep their intended timing.
          for (let copy = 0; copy < previewFps / (24 * playbackRates[name]); copy++) {
            fs.writeFileSync(path.join(frameDir, String(number++).padStart(4,'0')+'.png'), png);
          }
          if (number === 72) {
            await run("document.body.style.background='#20252b'");
            fs.writeFileSync(path.join(output,'dark-preview.png'), await captureFilmFrame());
            await run("document.body.style.background='#e6edf3'");
          }
        }
      }
      assert.ok(repeatedFrames / capturedFrames < .02, 'preview must not encode cached screenshots: ' + repeatedFrames + '/' + capturedFrames);
      console.log('Preview adjacent repeated source frames: ' + repeatedFrames + '/' + capturedFrames);
      // Small pets scale both paper and text, retaining five rows.
      const defaults = await run('JSON.parse(JSON.stringify(sprites[0].pet))');
      await run(`(async()=>{await sprites[0].dispose();sprites=[new PetSprite({...${JSON.stringify(defaults)},size:120})];await sprites[0].note.ready;sprites[0].note.show(true)})()`);
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      assert.equal(await run('sprites[0].note.pageLines'),5);
      assert.equal(await run('sprites[0].note.el.offsetWidth'),57);
      assert.equal(await run('getComputedStyle(sprites[0].note.el).backgroundColor'),'rgba(0, 0, 0, 0)');
      assert.equal(await run('sprites[0].noteFilm.scale()'),120/640);
      assert.equal(await run('sprites[0].noteFilm.canvas.hidden'),false);
      fs.writeFileSync(path.join(output,'small-pet.png'),(await win.webContents.capturePage()).toPNG());
      const edgePixels = await run(`(() => {
        const p=sprites[0], n=p.note, getLayout=n.getLayout;
        n.getLayout=()=>({...getLayout(),bounds:{x:0,y:0,w:400,h:430}});
        n.place(); p.noteFilm.draw(p.notePose.currentTime);
        const paper=p.noteFilm.getCard(), canvas=p.noteFilm.canvas;
        const card={left:p.margin.l+paper.x,top:p.margin.t+p.bottomPad+paper.y,right:p.margin.l+paper.x+paper.w,bottom:p.margin.t+p.bottomPad+paper.y+paper.h};
        const surface=canvas.getBoundingClientRect(), density=devicePixelRatio;
        return [[card.left+12,card.top+20],[card.right-12,card.bottom-12]].map(([x,y])=>
          Array.from(canvas.getContext('2d').getImageData(Math.round((x-surface.left)*density),Math.round((y-surface.top)*density),1,1).data));
      })()`);
      assert.ok(edgePixels.every(([r,g,b,a])=>r>150 && g>140 && b>120 && a>240), 'screen-edge text remains on the source paper: '+JSON.stringify(edgePixels));
      fs.writeFileSync(path.join(output,'screen-edge.png'),(await win.webContents.capturePage()).toPNG());
      console.log('PASS: supplied video preview and proportional small-pet paper');
      console.log(`Frames: ${frameDir} (${number} at ${previewFps} fps)`);
      app.exit(0); return;
    }
    if (process.argv.includes('--pages') || process.argv.length === 2) {
      await hover();
      await run('sprites[0].note.show(true)');
      for (let i=0; i<120 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      assert.equal(await run('sprites[0].notePhase'), 'idle', 'opening reaches the idle pose');
      assert.equal(await run('sprites[0].note.el.style.visibility'), '', 'editor is visible');
      assert.equal(await run('document.activeElement === sprites[0].note.input'), true, 'keyboard opening focuses after the animation');
      const firstPage = await run(`Array.from({length:sprites[0].note.pageLines},(_,i)=>String(i+1)).join('\\n')`);
      await run(`sprites[0].note.input.value=${JSON.stringify(firstPage)}; sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
      assert.equal(await run('sprites[0].note.next.disabled'), false);
      await run('sprites[0].note.next.click()');
      assert.equal(await run('sprites[0].note.pageNumber.textContent'), '2');
      assert.equal(await run('sprites[0].notePhase'), 'page');
      assert.equal(await run('getComputedStyle(sprites[0].note.el).backgroundColor'), 'rgba(0, 0, 0, 0)', 'the fixed card must not cover the turning video');
      assert.equal(await run('getComputedStyle(sprites[0].note.input).visibility'), 'hidden', 'text must not float over the turning page');
      assert.equal(await run('getComputedStyle(sprites[0].note.prev).visibility'), 'visible', 'navigation stays available during the turn');
      await run(`sprites[0].note.input.value='第二页'; sprites[0].note.input.dispatchEvent(new Event('input',{bubbles:true}))`);
      await run('sprites[0].note.flush()');
      assert.equal(await noteStore.read(await run('sprites[0].note.id')), firstPage+'\n第二页');
      await run(`sprites[0].note.input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));sprites[0].note.input.value='第二页和组词';`);
      await run('sprites[0].note.flush()');
      await run(`sprites[0].note.input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
      await run('sprites[0].note.flush()');
      assert.equal(await noteStore.read(await run('sprites[0].note.id')), firstPage+'\n第二页和组词');
      for (let i=0; i<100 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
      await run('sprites[0].note.prev.click()');
      assert.equal(await run('sprites[0].note.pageNumber.textContent'), '1');
      assert.equal(await run('sprites[0].note.input.value'), firstPage+'\n');
      assert.equal(await run('sprites[0].note.isOpen && !sprites[0].note.el.hidden'), true, 'note remains visible during page changes');
      win.webContents.invalidate();
      await delay(250);
      fs.writeFileSync(path.join(output, 'pages-preview.png'), (await win.webContents.capturePage({stayHidden:true,stayAwake:true})).toPNG());
      await load();
      assert.equal(await run('sprites[0].note.text'), firstPage+'\n第二页和组词', 'saved text survives reload');
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
      assert.ok(layoutCheck.every(item => item.lengths.every(([scroll, client]) => scroll <= client + 1)), 'each page fits within the measured writing area: '+JSON.stringify(layoutCheck));
      const waitForNoteIdle = async () => {
        for (let i=0; i<150 && await run('sprites[0].notePhase') !== 'idle'; i++) await delay(100);
        assert.equal(await run('sprites[0].notePhase'), 'idle');
        assert.equal(await run('sprites[0].note.pageTurning'), false);
      };
      await run(`(() => {
        const pet = sprites[0], n = pet.note;
        n.text = Array.from({length:n.pageLines*4+1}, (_, i) => 'line ' + i).join('\\n');
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
      assert.equal(await run('sprites[0].note.page'), 3, 'rapid clicks immediately select the latest page');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 4);
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 3);
      assert.deepEqual(await run('window.noteTurnClips'), ['下一页']);
      const turnDurations = await run('window.noteTurnDurations');
      assert.ok(turnDurations.every(ms => ms >= 850 && ms < 1800), 'rapid navigation shares one roughly one-second clip at 4x: ' + turnDurations);
      console.log('Page-turn elapsed ms: ' + turnDurations.map(Math.round).join(', '));
      assert.equal(await run('getComputedStyle(sprites[0].note.input).visibility'), 'visible');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 1);
      await run('window.noteTurnClips = []; sprites[0].note.prev.click(); sprites[0].note.prev.click()');
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 1);
      assert.deepEqual(await run('window.noteTurnClips'), ['上一页']);
      await run('window.noteTurnClips = []; sprites[0].note.next.click(); sprites[0].note.next.click(); sprites[0].note.close(); sprites[0].note.show(true)');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 2);
      await waitForNoteIdle();
      assert.equal(await run('sprites[0].note.page'), 3, 'closing retains the latest selected page');
      assert.deepEqual(await run('window.noteTurnClips'), ['下一页']);
      await run('sprites[0].playNoteClip = window.originalNoteClip; void 0');
      await run('sprites[0].note.close()');
      assert.equal(await run('sprites[0].notePhase'), 'closing');
      assert.equal(await run('sprites[0].notePose.playbackRate'), 4);
      await run(`sprites[0].onMenuAction({anim:'哈欠连天'})`);
      assert.equal(await run('sprites[0].notePhase'), null, 'a requested action cancels the closing animation');
      await delay(5500);
      assert.equal(await run('sprites[0].anim'), '哈欠连天', 'closing cannot override the newer action');
      assert.equal(await run('sprites[0].noteFilm.canvas.hidden'), true, 'cancelled closing cannot resurrect the note surface');
      console.log('PASS: 2x opening, 4x closing/page changes, five proportional lines, coalesced forward/back navigation, close/reopen and text preservation');
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
