import Anthropic from '@anthropic-ai/sdk';
import {createHmac,timingSafeEqual} from 'node:crypto';
import conversation from '../../public/conversation.js';

const practiceParagraph='This is a practice conversation. No messages are delivered, calls transferred, appointments booked or staff notified. Never claim to have performed these actions. The application handles collection and confirmation separately. If the caller wants to leave a message, ask what to pass along; don\'t say it\'s saved.';
export const phoneTraining=conversation.training.replace(practiceParagraph,'This is a live phone call. The phone application handles message collection, confirmation, persistence and transfers. Never claim a message was saved, sent or delivered, a person notified, or a transfer or booking completed. Those actions are confirmed separately by the application. If asked to leave a message, ask what to pass along.');
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createHandler({secret=()=>process.env.TWILIO_AUTH_TOKEN,getClient=()=>new Anthropic({timeout:5500,maxRetries:0}),now=()=>Date.now()}={}){
  return async request=>{
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const key=secret();
    if(!key)return json({error:'phone_gateway_unconfigured'},503);
    const timestamp=request.headers.get('x-aira-timestamp')||'';
    const signature=request.headers.get('x-aira-signature')||'';
    if(!/^\d{13}$/.test(timestamp)||Math.abs(now()-Number(timestamp))>60000||! /^[a-f0-9]{64}$/.test(signature))return json({error:'unauthorized'},401);
    const raw=await request.text();
    if(raw.length>32000)return json({error:'request_too_large'},413);
    const expected=createHmac('sha256',key).update(timestamp+'.'+raw).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return json({error:'unauthorized'},401);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
    if(!body||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>12||body.messages.some(t=>!t||!['user','assistant'].includes(t.role)||typeof t.content!=='string'||!t.content.trim()||t.content.length>2000))return json({error:'invalid_messages'},400);
    const messages=body.messages.slice();
    while(messages[0]?.role==='assistant')messages.shift();
    if(!messages.length||messages.at(-1).role!=='user')return json({error:'invalid_messages'},400);
    try{
      const client=getClient();
      const result=await client.messages.create({model:process.env.AIRA_MODEL||'claude-haiku-4-5',system:phoneTraining,messages,max_tokens:180});
      const reply=result.content?.find(p=>p.type==='text')?.text?.trim();
      if(!reply||result.stop_reason==='max_tokens')return json({error:'provider_incomplete'},502);
      return json({reply:conversation.normalizeBrand(reply),mode:'model',providerHost:client.baseURL?new URL(client.baseURL).hostname:undefined});
    }catch(error){console.error('Aira phone provider failure',error?.status||'configuration_or_network');return json({error:'provider_unavailable'},503);}
  };
}
export default createHandler();
export const config={path:'/api/phone-reply',method:'POST',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
