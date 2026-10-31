const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const twilio = require('twilio');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'aira-test-'));
Object.assign(process.env,{AIRA_DATA_DIR:dir,AIRA_OPERATOR_TOKEN:'test-operator',TWILIO_AUTH_TOKEN:'test-twilio',PUBLIC_URL:'https://voice.example.test',AIRA_TRANSFER_NUMBER:'+15555550199',AIRA_LOCAL_TEST:'false',ANTHROPIC_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',AIRA_ASSISTANT_FUNCTION_URL:''});
const {app,store,activeCalls,getAssistantReply} = require('../server');
let server, url;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));url=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
async function voice(route,body,valid=true){
  const response=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':valid?twilio.getExpectedTwilioSignature('test-twilio','https://voice.example.test'+route,body):'invalid'},body:new URLSearchParams(body)});
  return {status:response.status,text:await response.text()};
}
test('unsigned webhooks and unauthenticated operator API fail closed',async()=>{
  assert.equal((await voice('/voice/incoming',{CallSid:'bad'},false)).status,403);
  assert.equal((await fetch(url+'/api/messages')).status,401);
  assert.equal((await fetch(url+'/api/messages',{headers:{Authorization:'Bearer test-operator'}})).status,200);
});

test('recovery requires operator access and is idempotent',async()=>{
  const body=JSON.stringify({calls:[{id:'recovery-test',status:'completed'}],messages:[]});
  assert.equal((await fetch(url+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
  for(let i=0;i<2;i++)assert.equal((await fetch(url+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-operator'},body})).status,200);
  assert.equal(store.calls.filter(call=>call.id==='recovery-test').length,1);
});
test('signed call saves assembled message once, after explicit confirmation',async()=>{
  const start=store.messages.length;
  const incoming=await voice('/voice/incoming',{CallSid:'message',From:'+15555550100'});
  assert.match(incoming.text,/<Gather[^>]*actionOnEmptyResult="true"[^>]*><Say/);
  assert.match(incoming.text,/Molecular Project Development/);
  for(const SpeechResult of ['message','Please review my estimate','Jamie','5405550123']){
    assert.equal((await voice('/voice/respond',{CallSid:'message',SpeechResult})).status,200);
    assert.equal(store.messages.length,start);
  }
  const result=await voice('/voice/respond',{CallSid:'message',SpeechResult:'yes'});
  assert.match(result.text,/saved your message/);
  assert.equal(store.messages.length,start+1);
  assert.equal(store.messages[0].body,'Please review my estimate');
  assert.equal(store.messages[0].phone,'5405550123');
  await voice('/voice/respond',{CallSid:'message',SpeechResult:'yes'});
  assert.equal(store.messages.length,start+1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'aira-store.json'))).messages[0].name,'Jamie');
});
test('failed transfer returns to message flow instead of losing the session',async()=>{
  await voice('/voice/incoming',{CallSid:'transfer'});
  const result=await voice('/voice/respond',{CallSid:'transfer',SpeechResult:'speak to a human'});
  assert.match(result.text,/<Dial[^>]*action="\/voice\/transfer-result"/);
  assert.equal(activeCalls.has('transfer'),true);
  assert.match((await voice('/voice/transfer-result',{CallSid:'transfer',DialCallStatus:'no-answer'})).text,/leave a message/);
  assert.match((await voice('/voice/respond',{CallSid:'transfer',SpeechResult:'yes'})).text,/pass along/);
});
test('silence retries twice then ends gracefully; low confidence asks to repeat',async()=>{
  await voice('/voice/incoming',{CallSid:'silence'});
  const unclear=await voice('/voice/respond',{CallSid:'silence',SpeechResult:'bye',Confidence:'0.2'});
  assert.doesNotMatch(unclear.text,/<Hangup/);
  for(let i=0;i<2;i++)assert.match((await voice('/voice/respond',{CallSid:'silence'})).text,/<Gather/);
  assert.match((await voice('/voice/respond',{CallSid:'silence'})).text,/<Hangup/);
  assert.equal(activeCalls.has('silence'),false);
});
test('simulation reconstructs conversation but never saves practice messages',async()=>{
  const start=store.messages.length, history=[];
  let result;
  for(const text of ['message','Please call about the quote','Jamie','skip','yes']){
    const response=await fetch(url+'/api/simulate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-operator'},body:JSON.stringify({text,history})});
    assert.equal(response.status,200);result=await response.json();
    history.push({role:'user',text},{role:'assistant',text:result.reply});
  }
  assert.match(result.reply,/practice message hasn't been sent/);
  assert.equal(store.messages.length,start);
});
test('provider receives history exactly once and bounded conversational instructions',async()=>{
  let request;
  const provider={messages:{create:async(value)=>{request=value;return {content:[{type:'text',text:'What kind of project do you have in mind?'}]};}}};
  const call={memory:{},transcript:[{role:'caller',content:'Hello'},{role:'assistant',content:'How can I help?'},{role:'caller',content:'I need an application'}]};
  const result=await getAssistantReply(call,'I need an application',provider);
  assert.match(result.reply,/project/);
  assert.equal(request.messages.length,3);
  assert.equal(request.messages.filter(t=>t.content==='I need an application').length,1);
  assert.match(request.system,/one question at a time/);
  assert.match(request.system,/Never claim a message was saved/);
  assert.equal(request.model,'claude-sonnet-4-6');
});
test('provider outage falls back without losing message state',async()=>{
  const provider={messages:{create:async()=>{throw Error('test outage');}}};
  const call={memory:{},transcript:[{role:'caller',content:'cost'}]};
  assert.match((await getAssistantReply(call,'cost',provider)).reply,/quote/);
  assert.match((await getAssistantReply(call,'yes',provider)).reply,/pass along/);
  assert.equal(call.memory.stage,'body');
});
test('failed local save never claims success and permits retry',async()=>{
  const call={memory:{stage:'confirm',draft:{name:'Jamie',body:'Please call',contact:'',urgency:'Normal'}},transcript:[]};
  const write=fs.writeFileSync;
  const count=store.messages.length;
  try {
    fs.writeFileSync=()=>{throw Error('disk full');};
    assert.match((await getAssistantReply(call,'yes')).reply,/couldn't save/);
    assert.equal(store.messages.length,count);
    assert.equal(call.memory.stage,'saving');
  } finally {fs.writeFileSync=write;}
  assert.match((await getAssistantReply(call,'yes')).reply,/saved your message/);
  assert.equal(store.messages.length,count+1);
});

test('archive, restore and delete require auth and persist to disk',async()=>{
  const headers={Authorization:'Bearer test-operator','Content-Type':'application/json'};
  const options=await fetch(url+'/api/messages/example',{method:'OPTIONS'});
  assert.match(options.headers.get('access-control-allow-methods'),/PATCH, DELETE/);
  for(const collection of ['messages','calls']){
    const id='mutation-'+collection;
    store[collection].push({id,body:'Preserve content',status:'new'});
    const endpoint=url+'/api/'+collection+'/'+id;
    assert.equal((await fetch(endpoint,{method:'DELETE'})).status,401);
    assert.equal((await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify({status:'invalid'})})).status,400);
    for(const status of ['archived',collection==='messages'?'new':'completed']){
      const result=await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify({status})});
      assert.equal(result.status,200);
      assert.equal((await result.json()).body,'Preserve content');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'aira-store.json')))[collection].find(item=>item.id===id).status,status);
    }
    assert.equal((await fetch(endpoint,{method:'DELETE',headers})).status,200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'aira-store.json')))[collection].some(item=>item.id===id),false);
    assert.equal((await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify({status:'archived'})})).status,404);
  }
});
