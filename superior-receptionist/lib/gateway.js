const {createHmac}=require('node:crypto');
async function gatewayReply(transcript,{url=process.env.AIRA_GATEWAY_URL,secret=process.env.TWILIO_AUTH_TOKEN,fetchImpl=fetch,now=Date.now}={}) {
  if(!url||!secret)throw new Error('Phone gateway is not configured');
  if(new URL(url).protocol!=='https:')throw new Error('Phone gateway requires HTTPS');
  const messages=transcript.filter(t=>t.role==='caller'||t.role==='assistant').slice(-12).map(t=>({role:t.role==='caller'?'user':'assistant',content:String(t.content).slice(0,2000)}));
  const body=JSON.stringify({messages});
  const timestamp=String(now());
  const signature=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
  const response=await fetchImpl(url,{method:'POST',signal:AbortSignal.timeout(7000),headers:{'Content-Type':'application/json','x-aira-timestamp':timestamp,'x-aira-signature':signature},body});
  if(!response.ok)throw new Error('Phone gateway returned '+response.status);
  const data=await response.json();
  if(data.mode!=='model'||typeof data.reply!=='string'||!data.reply.trim())throw new Error('Phone gateway returned no model reply');
  return data.reply;
}
module.exports={gatewayReply};
