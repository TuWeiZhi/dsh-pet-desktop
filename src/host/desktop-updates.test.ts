import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { newerVersion, selectRelease, downloadRelease, verifyInstaller } = require('../../runtime/electron-helper/desktop-updates.js');
const { loginOptions, createDesktopControls } = require('../../runtime/electron-helper/desktop-controls.js');

const bytes = Buffer.from('test installer bytes (never executed)');
const digest = createHash('sha256').update(bytes).digest('hex');
const release = {
  tag_name:'v0.5.0', draft:false, prerelease:false,
  assets:[{name:'dsh-pet-0.5.0-setup.exe',size:bytes.length,digest:'sha256:'+digest,browser_download_url:'https://github.com/TuWeiZhi/dsh-pet-desktop/releases/download/v0.5.0/dsh-pet-0.5.0-setup.exe'}],
};
const response = data => {
  const result = new Response(data);
  Object.defineProperty(result,'url',{value:release.assets[0].browser_download_url});
  return result;
};

test('numeric release versions and exact installer source are validated', () => {
  assert.equal(newerVersion('0.10.0','0.9.9'),true);
  assert.equal(newerVersion('0.4.4','0.4.4'),false);
  assert.equal(newerVersion('0.4.3','0.4.4'),false);
  assert.equal(selectRelease(release,'0.4.4').version,'0.5.0');
  assert.equal(selectRelease({...release,prerelease:true},'0.4.4'),null);
  assert.throws(()=>selectRelease({...release,assets:[{...release.assets[0],browser_download_url:'https://evil.example/setup.exe'}]},'0.4.4'),/来源/);
  assert.throws(()=>selectRelease({...release,assets:[{...release.assets[0],digest:null}]},'0.4.4'),/校验/);
});

test('downloads verified bytes and rejects corruption without leaving partial files', async t => {
  const dir=await mkdtemp(join(tmpdir(),'pet-update-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const update=selectRelease(release,'0.4.4');
  const file=await downloadRelease(update,dir,{fetch:async()=>response(bytes)});
  assert.deepEqual(await readFile(file),bytes);
  await verifyInstaller(file,update);
  await assert.rejects(downloadRelease(update,dir,{fetch:async()=>response(Buffer.alloc(bytes.length))}),/校验/);
  assert.equal((await readdir(dir)).some(name=>name.endsWith('.part')),false);
  await writeFile(file,'tampered');
  await assert.rejects(verifyInstaller(file,update),/校验/);
});

test('cancelling a download leaves no partial installer', async t => {
  const dir=await mkdtemp(join(tmpdir(),'pet-update-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(downloadRelease(selectRelease(release,'0.4.4'),dir,{signal:controller.signal,fetch:async()=>response(bytes)}));
  assert.deepEqual(await readdir(dir),[]);
});

test('login launch targets the app root in development and the executable when packaged', () => {
  assert.deepEqual(loginOptions({isPackaged:false,execPath:'C:\\Electron\\electron.exe',appRoot:'D:\\My Pet'}),{name:'dsh-pet-desktop',path:'C:\\Electron\\electron.exe',args:['"D:\\My Pet"']});
  assert.deepEqual(loginOptions({isPackaged:true,execPath:'C:\\Apps\\dsh-pet.exe',appRoot:'unused'}),{name:'dsh-pet-desktop',path:'C:\\Apps\\dsh-pet.exe',args:[]});
});

function controlsFixture(answers, overrides = {}) {
  let enabled=false;
  const calls=[];
  const dialogs=[];
  // Electron's openAtLogin checks the default AppUserModelID, not our custom Run entry.
  const app={isPackaged:true,getLoginItemSettings:()=>({openAtLogin:false,launchItems:enabled?[{name:'dsh-pet-desktop',scope:'user',enabled}]:[]}),setLoginItemSettings:options=>{enabled=options.openAtLogin;calls.push(['login',options]);}};
  const options={app,version:'0.4.4',appRoot:'D:/app',directory:'D:/cache',platform:'win32',execPath:'D:/app/dsh-pet.exe',
    dialog:{showMessageBox:async options=>{dialogs.push(options);return {response:answers.shift()??1};}},
    shell:{openPath:async()=>{calls.push('launch');return '';}},
    beforeInstall:async()=>{calls.push('flush');},quit:async()=>{calls.push('quit');},resume:async()=>{calls.push('resume');},
    service:{checkRelease:async version=>{assert.equal(version,'0.4.4');return selectRelease(release,version);},downloadRelease:async()=>{calls.push('download');return 'D:/cache/setup.exe';},verifyInstaller:async()=>{calls.push('verify');}},
    ...overrides};
  return {controls:createDesktopControls(options),calls,dialogs,options};
}

test('startup is not enabled on construction; the checkbox changes only on user action', async () => {
  const {controls,calls}=controlsFixture([]);
  const startup=controls.items()[0];
  assert.equal(startup.checked,false);
  assert.deepEqual(calls,[]);
  startup.checked=true;
  await controls.setStartup(startup);
  assert.equal(startup.checked,true);
  assert.equal(calls[0][1].path,'D:/app/dsh-pet.exe');
  startup.checked=false;
  await controls.setStartup(startup);
  assert.equal(startup.checked,false);
});

test('unrelated and machine startup entries do not mark the user checkbox as enabled', () => {
  const {controls}=controlsFixture([],{app:{isPackaged:true,getLoginItemSettings:()=>({openAtLogin:true,launchItems:[
    {name:'another-app',scope:'user',enabled:true},
    {name:'dsh-pet-desktop',scope:'machine',enabled:true},
  ]})}});
  assert.equal(controls.items()[0].checked,false);
});

test('startup checks immediately, then every 24 hours without opening a dialog', async () => {
  let tick, interval, checks=0;
  const fixture=controlsFixture([],{
    setInterval: (callback, ms) => { tick=callback; interval=ms; },
    service:{checkRelease:async()=>{ checks++; return null; }},
  });
  fixture.controls.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checks,1);
  assert.equal(interval,24*60*60*1000);
  assert.equal(fixture.dialogs.length,0);
  const update={};
  fixture.controls.refresh({getMenuItemById:id=>id==='check-updates'?update:null});
  assert.equal(update.label,'当前版本：v0.4.4');
  tick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checks,2);
});

test('available update is shown in the tray and installation needs a separate click', async () => {
  const {controls,calls,dialogs}=controlsFixture([]);
  const update={};
  const refresh=()=>controls.refresh({getMenuItemById:id=>id==='check-updates'?update:null});
  await controls.check();
  refresh();
  assert.match(update.label,/点击更新/);
  assert.equal(update.enabled,true);
  assert.deepEqual(calls,[]);
  assert.equal(dialogs.length,0);
  await controls.update();
  refresh();
  assert.match(update.label,/点击安装/);
  assert.deepEqual(calls,['download']);
  await controls.update();
  assert.deepEqual(calls,['download','verify','flush','launch','quit']);
  assert.equal(dialogs.length,0);
});

test('scheduled checks do not overlap an active check or download', async () => {
  let finishCheck, finishDownload, checks=0;
  const fixture=controlsFixture([],{service:{
    checkRelease:()=>{ checks++; return new Promise(resolve=>{finishCheck=resolve;}); },
    downloadRelease:()=>new Promise(resolve=>{finishDownload=resolve;}),
  }});
  const first=fixture.controls.check();
  await fixture.controls.check();
  assert.equal(checks,1);
  finishCheck(selectRelease(release,'0.4.4'));
  await first;
  const download=fixture.controls.update();
  await fixture.controls.check();
  assert.equal(checks,1);
  finishDownload('D:/cache/setup.exe');
  await download;
  await fixture.controls.check();
  assert.equal(checks,1);
});

test('cancelling a download restores the available update action', async () => {
  const fixture=controlsFixture([],{service:{
    checkRelease:async()=>selectRelease(release,'0.4.4'),
    downloadRelease:(_release,_directory,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))),
  }});
  await fixture.controls.check();
  const pending=fixture.controls.update();
  fixture.controls.items().find(item=>item.id==='cancel-update').click();
  await pending;
  const update={};
  fixture.controls.refresh({getMenuItemById:id=>id==='check-updates'?update:null});
  assert.match(update.label,/点击更新/);
  assert.equal(update.enabled,true);
});

test('a failed background check is visible and can be retried', async () => {
  let checks=0;
  const {controls,dialogs}=controlsFixture([],{service:{checkRelease:async()=>{checks++; if (checks===1) throw new Error('offline'); return null;}}});
  const update={};
  await controls.check();
  controls.refresh({getMenuItemById:id=>id==='check-updates'?update:null});
  assert.match(update.label,/检查更新失败/);
  assert.equal(update.enabled,true);
  assert.equal(dialogs.length,0);
  await controls.update();
  controls.refresh({getMenuItemById:id=>id==='check-updates'?update:null});
  assert.equal(update.label,'当前版本：v0.4.4');
});

test('download waits for a separate installation click and flushes before launch', async () => {
  const {controls,calls}=controlsFixture([]);
  await controls.check();
  await controls.update();
  assert.deepEqual(calls,['download']);
  await controls.update();
  assert.deepEqual(calls,['download','verify','flush','launch','quit']);
});

test('a failed verification cannot launch the installer', async () => {
  const fixture=controlsFixture([]);
  fixture.options.service.verifyInstaller=async()=>{throw new Error('checksum mismatch');};
  await fixture.controls.check();
  await fixture.controls.update();
  await fixture.controls.update();
  assert.ok(!fixture.calls.includes('launch'));
  assert.ok(fixture.calls.includes('resume'));
});

test('notes must save successfully before installation starts', async () => {
  const {controls,calls}=controlsFixture([],{beforeInstall:async()=>{throw new Error('disk full');}});
  await controls.check();
  await controls.update();
  await controls.update();
  assert.ok(!calls.includes('launch'));
  assert.ok(!calls.includes('quit'));
  assert.ok(calls.includes('resume'));
});
