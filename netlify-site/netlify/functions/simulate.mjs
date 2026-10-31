import Anthropic from '@anthropic-ai/sdk';
import conversation from '../../public/conversation.js';

const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createHandler({getClient=()=>new Anthropic({timeout:8000,maxRetries:0}),model=process.env.AIRA_MODEL||'claude-haiku-4-5'}={}) {
  return async request => {
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    let body;
    try {
      const raw=await request.text();
      if(raw.length>48000)return json({error:'request_too_large'},413);
      body=JSON.parse(raw);
    } catch {return json({error:'invalid_json'},400);}
    if(!body || typeof body.text!=='string' || !body.text.trim() || body.text.length>2000)return json({error:'invalid_text'},400);
    if(body.history!==undefined && (!Array.isArray(body.history)||body.history.length>60))return json({error:'invalid_history'},400);
    const history=body.history||[];
    if(history.some(t=>!t || !['user','assistant'].includes(t.role)||typeof t.text!=='string'||t.text.length>2000))return json({error:'invalid_history'},400);
    const state={};
    for(const turn of history) {
      if(turn.role==='user') {
        const step=conversation.advance(state,turn.text);
        if(step?.save)conversation.saved(state);
        if(!step)conversation.fallback(turn.text,state);
      } else if(/would you like to leave (?:a message|one)/i.test(turn.text))state.offerMessage=true;
    }
    const step=conversation.advance(state,body.text);
    if(step) {
      if(step.save)return json({reply:"That's confirmed for this practice conversation. No message has been sent to the team.",mode:'practice',draft:step.save});
      return json({reply:step.reply,mode:'guided',draft:state.draft||{}});
    }
    // No caller-supplied system prompt, private records, persistence, or external actions.
    const messages=history.filter(t=>t.text.trim()).map(t=>({role:t.role,content:t.text}));
    while(messages[0]?.role==='assistant')messages.shift();
    messages.push({role:'user',content:body.text.trim()});
    try {
      const client=getClient();
      const providerHost=client.baseURL ? new URL(client.baseURL).hostname : undefined;
      const result=await client.messages.create({model,max_tokens:220,system:conversation.training,messages});
      const reply=result.content?.find(part=>part.type==='text')?.text?.trim();
      if(!reply || result.stop_reason==='max_tokens')return json({error:'provider_incomplete'},502);
      return json({reply:conversation.normalizeBrand(reply),mode:'model',providerHost});
    } catch(error) {
      const description=String(error?.message||'');
      const category=/credit balance|billing|quota/i.test(description)?'provider_billing':/api.?key|authentication|unauthorized/i.test(description)?'provider_configuration':'provider_unavailable';
      console.error('Aira provider failure',category,error?.status||'');
      return json({error:category},503);
    }
  };
}
export default createHandler();
export const config={path:'/api/simulate',method:'POST',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
