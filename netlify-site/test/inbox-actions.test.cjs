const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
function context(ok){
 const ctx={state:{serverUrl:'https://backend.test',messages:[{id:'m',status:'new'}],calls:[{id:'c',status:'completed'}]},localStorage:{setItem(){}},addTask(){},renderInbox(){},renderTasks(){},renderCalls(){},showToast(){},fetchJsonWithMethod:async()=>{if(!ok)throw Object.assign(new Error('Unauthorized'),{status:401});return {ok:true};}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('async function handleMessageAction'),source.indexOf('function messageFromCall')),ctx);
 return ctx;
}
test('failed server mutations leave messages and call logs unchanged',async()=>{
 const ctx=context(false);
 for(const action of ['archive','delete']){
  await ctx.handleMessageAction(action,'m');await ctx.handleCallAction(action,'c');
  assert.equal(ctx.state.messages.length,1);assert.equal(ctx.state.messages[0].status,'new');
  assert.equal(ctx.state.calls.length,1);assert.equal(ctx.state.calls[0].status,'completed');
 }
});
test('confirmed server mutations update the inbox and calls',async()=>{
 const ctx=context(true);
 await ctx.handleMessageAction('archive','m');await ctx.handleCallAction('archive','c');
 assert.equal(ctx.state.messages[0].status,'archived');assert.equal(ctx.state.calls[0].status,'archived');
 await ctx.handleMessageAction('delete','m');await ctx.handleCallAction('delete','c');
 assert.equal(ctx.state.messages.length,0);assert.equal(ctx.state.calls.length,0);
});
