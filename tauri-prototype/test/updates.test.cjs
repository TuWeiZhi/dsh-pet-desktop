const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { runInNewContext } = require('node:vm');
const { tmpdir } = require('node:os');
const path = require('node:path');
const bytes = Buffer.from('test installer payload, never executed');
const hash=createHash('sha256').update(bytes).digest('hex');
const prefix='https://github.com/TuWeiZhi/dsh-pet-desktop/releases';
const version='0.7.8',name=`dsh-pet-tauri-${version}-setup.exe`;
const url=`${prefix}/download/v${version}/${name}`;
async function updater(){const {adaptUpdates}=await import('../host/adapt.mjs');const source=adaptUpdates(readFileSync(path.resolve(__dirname,'../../runtime/electron-helper/desktop-updates.js'),'utf8'));const module={exports:{}};runInNewContext(source,{module,require,Buffer,URL,AbortSignal,console});return module.exports;}
const asset=(name,url)=>({name,browser_download_url:url,size:bytes.length,digest:'sha256:'+hash});
test('Tauri update selects its own artifact and rejects Electron-only releases',async()=>{
  const service=await updater();const electron=asset(`dsh-pet-${version}-setup.exe`,`${prefix}/download/v${version}/dsh-pet-${version}-setup.exe`);
  const release={tag_name:'v'+version,assets:[electron,asset(name,url)]};
  assert.equal(service.selectRelease(release,'0.7.7').name,name);
  assert.throws(()=>service.selectRelease({...release,assets:[electron]},'0.7.7'),/安装包/);
});
test('rate-limit fallback fetches the independent Tauri manifest',async()=>{
  const service=await updater(),requests=[];
  const release=await service.checkRelease('0.7.7',async address=>{
    requests.push(String(address));
    if(String(address).includes('api.github.com'))return new Response('',{status:429});
    if(String(address).endsWith('/latest'))return new Response(null,{status:302,headers:{location:prefix+'/tag/v'+version}});
    assert.ok(String(address).endsWith('/tauri-update-manifest.json'));
    const response=new Response(JSON.stringify({version,size:bytes.length,sha256:hash}));
    Object.defineProperty(response,'url',{value:address});return response;
  });
  assert.equal(release.url,url);assert.equal(release.sha256,hash);assert.equal(requests.length,3);
});
test('download verifies digest; cancellation leaves no partial file',async()=>{
  const service=await updater(),dir=await fs.mkdtemp(path.join(tmpdir(),'tauri-update-test-'));
  const release=service.selectRelease({tag_name:'v'+version,assets:[asset(name,url)]},'0.7.7');
  const response=data=>{const result=new Response(data);Object.defineProperty(result,'url',{value:url});return result;};
  const file=await service.downloadRelease(release,dir,{fetch:async()=>response(bytes)});
  await service.verifyInstaller(file,release);await fs.writeFile(file,'corrupt');await assert.rejects(service.verifyInstaller(file,release),/大小|SHA/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(service.downloadRelease(release,dir,{signal:controller.signal,fetch:async()=>response(bytes)}));
  assert.equal((await fs.readdir(dir)).filter(name=>name.endsWith('.part')).length,0);
});
