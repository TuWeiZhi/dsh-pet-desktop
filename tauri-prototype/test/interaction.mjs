import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from './cdp.mjs';

const client = await connect(Number(process.env.DSH_PET_TAURI_DEBUG_PORT || 9337));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = new URL('../evidence/', import.meta.url);
mkdirSync(evidence, { recursive: true });
const result = { passed: false };
try {
  result.note = await client.evaluate(`(async()=>{
    const pet = sprites[0], note = pet.note;
    await note.ready; await note.flush();
    pet.stopMove();pet.stopThrow();pet.switchTo(pet.animations.idle[0],false);
    const cursor=await __TAURI_INTERNALS__.invoke('pointer_state');
    pet.sendBounds(cursor.x/CONFIG.scale-pet.halfW,cursor.y/CONFIG.scale-pet.halfH);
    note.show(true);
    for(let i=0;i<150 && pet.notePhase!=='idle';i++) await new Promise(r=>setTimeout(r,50));
    const original = note.text;
    const stored = await petBridge.readNote(note.id);
    note.page = 1; note.renderPage();
    note.prev.click();
    const start = performance.now();
    for(let i=0;i<150 && pet.notePhase!=='idle';i++) await new Promise(r=>setTimeout(r,50));
    const elapsed = performance.now()-start;
    return {id:note.id,original,stored,page:note.page,phase:pet.notePhase,turnMilliseconds:elapsed,
      lineCount:note.pageLines,font:getComputedStyle(note.input).fontFamily,errors:window.__petTauri.errors};
  })()`);
  assert.match(result.note.original, /Tauri 原型验证/);
  assert.match(result.note.original, /第二页：重启后仍应保留/);
  assert.equal(result.note.stored, result.note.original);
  assert.equal(result.note.page, 0);
  assert.equal(result.note.phase, 'idle');
  assert.equal(result.note.lineCount, 5);
  assert.deepEqual(result.note.errors, []);
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('note-webview2.png', evidence), Buffer.from(screenshot.data, 'base64'));

  result.alpha = await client.evaluate(`(async()=>{
    const video=document.createElement('video');video.muted=true;video.preload='auto';
    video.src=BASE+'/thumb/main/'+encodeURIComponent(sprites[0].animations.idle[0])+'.webm';
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('Video decode failed'));video.load()});
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let transparent=0,opaque=0;
    // The unchanged VP9 assets quantize some clear pixels to alpha 1/255.
    for(let i=3;i<rgba.length;i+=4){if(rgba[i]<=2)transparent++;if(rgba[i]===255)opaque++;}
    return {width:canvas.width,height:canvas.height,transparent,opaque,png:canvas.toDataURL('image/png')};
  })()`);
  assert.ok(result.alpha.transparent > 10000);
  assert.ok(result.alpha.opaque > 1000);
  writeFileSync(new URL('idle-decoded-webview2.png', evidence), Buffer.from(result.alpha.png.split(',')[1], 'base64'));
  delete result.alpha.png;

  const start = await client.evaluate(`(async()=>{
    const pet=sprites[0];pet.stopMove();pet.stopThrow();
    const box=pet.hit.getBoundingClientRect();
    return {pos:{...pet.pos},native:await __TAURI_INTERNALS__.invoke('pointer_state'),x:box.x+box.width/2,y:box.y+box.height/3,scale:CONFIG.scale};
  })()`);
  // CDP cannot hold the OS mouse button: moving a native window generates a real
  // buttons=0 event and correctly cancels that synthetic drag. Test the native
  // movement boundary separately; real down/move/up is verified with Computer Use.
  for (let i = 1; i <= 40; i++) {
    await client.evaluate(`sprites[0].sendBounds(${start.pos.x + 180 * i / 40},${start.pos.y + 60 * i / 40})`);
    await delay(20);
  }
  await delay(150);
  result.windowMovement = await client.evaluate(`(async()=>{sprites[0].stopThrow();return {pos:sprites[0].pos,drag:sprites[0].dragState,native:await __TAURI_INTERNALS__.invoke('pointer_state'),bridge:__petTauri.status(),errors:__petTauri.errors};})()`);
  result.windowMovement.start = start.pos;
  assert.ok(result.windowMovement.native.bounds.x - start.native.bounds.x >= 175, 'The native window must follow renderer bounds');
  assert.equal(result.windowMovement.drag.active, false);
  assert.equal(result.windowMovement.bridge.input.dragging, false);
  assert.deepEqual(result.windowMovement.errors, []);
  result.passed = true;
  console.log(JSON.stringify(result, null, 2));
} finally {
  writeFileSync(new URL('interaction.json', evidence), JSON.stringify(result, null, 2));
  client.close();
}
