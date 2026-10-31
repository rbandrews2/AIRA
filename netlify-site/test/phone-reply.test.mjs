import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,phoneTraining} from '../netlify/functions/phone-reply.mjs';
import gateway from '../../superior-receptionist/lib/gateway.js';
const secret='synthetic-test-only';
test('phone adapter signs bounded history and uses live-phone instructions',async()=>{
  let captured;
  const handler=createHandler({secret:()=>secret,getClient:()=>({messages:{create:async value=>{captured=value;return {content:[{type:'text',text:'What can I help you with?'}],stop_reason:'end_turn'};}}})});
  const reply=await gateway.gatewayReply([{role:'caller',content:'We need software for our crew'}],{url:'https://gateway.example/api/phone-reply',secret,fetchImpl:(url,options)=>handler(new Request(url,options))});
  assert.equal(reply,'What can I help you with?');
  assert.equal(captured.messages.length,1);
  assert.doesNotMatch(phoneTraining,/This is a practice conversation/);
  assert.match(phoneTraining,/live phone call/);
});
test('unsigned, altered and expired phone requests cannot use the model',async()=>{
  const handler=createHandler({secret:()=>secret,getClient:()=>{throw new Error('should never run');}});
  assert.equal((await handler(new Request('https://example.test',{method:'POST',body:'{}'}))).status,401);
  for(const expired of [false,true]){
    await assert.rejects(()=>gateway.gatewayReply([{role:'caller',content:'hello'}],{url:'https://gateway.example',secret,now:()=>expired?Date.now()-120000:Date.now(),fetchImpl:(url,options)=>handler(new Request(url,{...options,body:expired?options.body:'{}'}))}),/401/);
  }
});
test('phone provider failure cannot become a successful spoken model response',async()=>{
  await assert.rejects(()=>gateway.gatewayReply([{role:'caller',content:'hello'}],{url:'https://gateway.example',secret,fetchImpl:async()=>Response.json({error:'provider_unavailable'},{status:503})}),/503/);
});
