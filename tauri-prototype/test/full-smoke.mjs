import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { connect } from './cdp.mjs';

const profile=resolve('evidence/full-profile');
assert.ok(profile.startsWith(resolve('evidence')+sep));
const runtime=JSON.parse(readFileSync(join(profile,'dsh-pet/standalone-runtime.json')));
const base=`http://127.0.0.1:${runtime.port}`;
const headers={'x-dsh-pet-token':runtime.token,'content-type':'application/json'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,method='GET',body){const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000)});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||response.statusText),{status:response.status});return value;}
async function pet(){for(let i=0;i<120;i++){try{const client=await connect(9340,'petIndex=0');if(await client.evaluate('Boolean(window.__dshPetDebug?.configOk&&sprites[0]?.note.loaded)'))return client;client.close();}catch{}await delay(100);}throw Error('Pet did not become ready');}
let pending=false, cancelled=false, calls=0;
const server=createServer(async(req,res)=>{
  calls++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
  if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model',display_name:'Fixture model'}],has_more:false}));return;}
  assert.equal(body.stream,true);
  const anthropic=req.url.includes('/anthropic/');
  assert.equal(anthropic?req.headers['x-api-key']:req.headers.authorization,anthropic?'fixture-secret':'Bearer fixture-secret');
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(pending){res.write(': waiting\n\n');res.on('close',()=>{cancelled=true});return;}
  for(const text of ['模拟','回复']){
    res.write(anthropic?'event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text}})+'\n\n':'data: '+JSON.stringify({choices:[{index:0,delta:{content:text}}]})+'\n\n');
    await delay(20);
  }
  res.end(anthropic?'event: message_stop\ndata: {"type":"message_stop"}\n\n':'data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const results={};let client;
try{
  assert.equal((await fetch(base+'/standalone-ai/settings')).status,403);
  assert.equal((await fetch(base+'/standalone-ai/settings',{headers:{...headers,origin:'https://untrusted.example'}})).status,403);
  results.authentication=true;
  let config=await api('/dsh-pet-7340/config');
  const body={pets:config.main.pets,chatMemoryRounds:3,chatImageEnabled:false};
  client=await pet();
  await client.evaluate(`(()=>{const n=sprites[0].note;n.text='';n.pages=[{start:0,end:0,lines:1}];n.page=0;n.input.value='未等防抖就保存设置：中文便签';n.input.dispatchEvent(new Event('input',{bubbles:true}));return n.text})()`);
  await api('/dsh-pet-7340/config','PUT',body);client.close();client=await pet();
  assert.equal(await client.evaluate('sprites[0].note.text'),'未等防抖就保存设置：中文便签');
  results.restart_note_barrier=true;

  const notes=join(profile,'notes'),backup=join(profile,'notes-save-test-backup');
  const before=readFileSync(join(profile,'dsh-pet/main-config.jsonc'),'utf8');
  renameSync(notes,backup);writeFileSync(notes,'blocked test directory');
  try{
    await client.evaluate(`(()=>{const n=sprites[0].note;n.input.value='写盘失败后仍应保留的草稿';n.input.dispatchEvent(new Event('input',{bubbles:true}));return n.text})()`);
    await assert.rejects(api('/dsh-pet-7340/config','PUT',{...body,whisperBubbleSec:17}),error=>error.status===503);
    assert.equal(readFileSync(join(profile,'dsh-pet/main-config.jsonc'),'utf8'),before);
    assert.equal(await client.evaluate('sprites[0].note.input.readOnly'),false);
  }finally{unlinkSync(notes);renameSync(backup,notes);}
  await client.evaluate('sprites[0].note.flush()');results.save_failure_preserves_state=true;

  for(const protocol of ['openai-compatible','anthropic']){
    const settings={protocol,baseUrl:origin+(protocol==='anthropic'?'/anthropic':'/openai/v1'),apiKey:'fixture-secret',model:'fixture-model',enabled:true};
    const models=await api('/standalone-ai/models','POST',settings);assert.equal(models.ok,true);assert.equal(models.models[0].id,'fixture-model');
    const saved=await api('/standalone-ai/settings','POST',settings);assert.equal(saved.hasKey,true);assert.ok(!JSON.stringify(saved).includes('fixture-secret'));
    const check=await api('/standalone-ai/test','POST',{});assert.equal(check.ok,true);
    const reply=await client.evaluate(`fetch(BASE+'/chat?pet=main&surface=desktop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'请回复测试'})}).then(r=>r.json())`);
    assert.equal(reply.ok,true,JSON.stringify(reply));assert.equal(reply.text,'模拟回复');results[protocol]=true;
    const history=await api('/dsh-pet-7340/chat?pet=main');assert.ok(history.messages.some(message=>message.content==='模拟回复'));
  }
  pending=true;const count=calls;
  const inflight=api('/dsh-pet-7340/chat?pet=main&surface=desktop','POST',{text:'等待取消'});
  for(let i=0;i<50&&calls===count;i++)await delay(20);
  await api('/standalone-ai/settings','POST',{enabled:false});
  assert.equal((await inflight).ok,false);for(let i=0;i<50&&!cancelled;i++)await delay(20);assert.equal(cancelled,true);
  results.ai_cancel_on_disable=true;pending=false;

  const buddy={...body.pets[0],id:'buddy',name:'测试伙伴',size:240,position:{corner:'bottom-left',marginX:40,marginY:40}};
  await api('/dsh-pet-7340/config','PUT',{...body,pets:[...body.pets,buddy]});client.close();client=await pet();
  const targets=await (await fetch('http://127.0.0.1:9340/json/list')).json();assert.equal(targets.filter(t=>t.type==='page'&&t.url.includes('pet.localhost')).length,2);
  await client.evaluate('petBridge.flushNotes()');await client.evaluate('petBridge.resumeNotes()');results.multiple_windows_and_flush=true;
  await api('/dsh-pet-7340/config','PUT',body);client.close();client=await pet();
  assert.equal((await client.evaluate('window.__petTauri.errors')).length,0);
  results.passed=true;writeFileSync('evidence/full-smoke.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{
  client?.close();await api('/standalone-ai/settings','POST',{enabled:false,clearApiKey:true}).catch(()=>{});
  server.closeAllConnections();await new Promise(r=>server.close(r));
}
