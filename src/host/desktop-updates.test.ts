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

test('download then postpone never launches an installer; later confirmation flushes before launch', async () => {
  const {controls,calls}=controlsFixture([0,1,0]);
  await controls.check();
  assert.deepEqual(calls,['download']);
  await controls.check();
  assert.deepEqual(calls,['download','verify','flush','launch','quit']);
});

test('a failed verification cannot launch the installer', async () => {
  const fixture=controlsFixture([0,0]);
  fixture.options.service.verifyInstaller=async()=>{throw new Error('checksum mismatch');};
  await fixture.controls.check();
  assert.ok(!fixture.calls.includes('launch'));
  assert.ok(fixture.dialogs.some(dialog=>dialog.type==='error'));
});

test('notes must save successfully before installation starts', async () => {
  const {controls,calls}=controlsFixture([0,0],{beforeInstall:async()=>{throw new Error('disk full');}});
  await controls.check();
  assert.ok(!calls.includes('launch'));
  assert.ok(!calls.includes('quit'));
  assert.ok(calls.includes('resume'));
});
