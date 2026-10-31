const {test} = require('node:test');
const assert = require('node:assert/strict');
const c = require('../public/conversation');

test('one question per turn; no save before confirmation', () => {
  const state = {};
  for (const input of ['Please take a message', 'The dispatch screen is broken', 'My name is Jamie', 'five four zero five five five zero one two three']) {
    const result = c.advance(state, input);
    assert.equal(result.save, undefined);
    assert.equal((result.reply.match(/\?/g) || []).length, 1);
  }
  assert.equal(state.stage, 'confirm');
  assert.match(state.lastQuestion, /5 4 0 5 5 5 0 1 2 3/);
  assert.deepEqual(c.advance(state,'yes').save, {name:'Jamie',contact:'5405550123',phone:'5405550123',email:'',body:'The dispatch screen is broken',urgency:'Normal'});
});
test('declined name and contact are optional', () => {
  const state = {};
  for (const input of ['callback', 'Please review the delivery issue', 'skip', "I don't want to give my number"]) c.advance(state,input);
  assert.equal(state.stage, 'confirm');
  assert.equal(c.advance(state,'correct').save.contact,'');
});
test('correct number without asking for name again', () => {
  const state = {};
  for (const input of ['message','Need a quote','Jamie','5405550123','no','number','5405550124']) c.advance(state,input);
  assert.equal(state.stage,'confirm');
  assert.equal(c.advance(state,'yes').save.phone,'5405550124');
});
test('respect already supplied name and contact', () => {
  const state = {};
  c.advance(state,'This is Jamie, call me back at 5405550123');
  const result = c.advance(state,'Please send a project quote');
  assert.equal(state.stage,'confirm');
  assert.match(result.reply,/Jamie/);
});
test('message offers, cancellation, repeat, and isolation', () => {
  const a = {offerMessage:true}, b = {};
  c.advance(a,'yes');
  assert.equal(a.stage,'body');
  assert.match(c.advance(a,'repeat').reply,/pass along/);
  assert.equal(c.advance(b,"I don't want a callback"),null);
  c.advance(a,'cancel');
  assert.equal(a.stage,undefined);
  assert.equal(b.stage,undefined);
});
test('no substring false positives for goodbye, transfer, or confirmation', () => {
  assert.equal(c.goodbye("that's all the information about the error"),false);
  assert.equal(c.wantsTransfer('I need a personalized application'),false);
  assert.equal(c.wantsTransfer("don't transfer me"),false);
  assert.equal(c.wantsTransfer('May I speak to a person?'),true);
  const state={stage:'confirm',draft:{}};
  assert.equal(c.advance(state,'yesterday it was incorrect').save,undefined);
});
test('legacy brand variants normalize and fallback does not promise delivery', () => {
  assert.equal(c.normalizeBrand('Superior Consultations LLC'),c.company);
  assert.equal(c.normalizeBrand('Superior Consultation, LLC'),c.company);
  assert.doesNotMatch(c.fallback('cost'),/9\.99|4500/);
});
