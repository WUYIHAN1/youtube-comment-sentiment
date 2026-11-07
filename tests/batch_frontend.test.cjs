const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const element = id => {
  if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:true,disabled:false,addEventListener(){}});
  return elements.get(id);
};
const context=vm.createContext({window:{addEventListener(){}},location:{origin:"http://localhost"},document:{getElementById:element,querySelectorAll:()=>[]},console,URL,Blob,setTimeout,confirm:()=>true,fetch:async()=>{throw new Error('network failure');}});
vm.runInContext(fs.readFileSync('frontend/batch.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
(async()=>{
  assert.equal(run(`videoId('https://evil.example/watch?v=abcdefghijk')`),null);
  assert.equal(run(`videoId('https://www.youtube.com/watch?v=abcdefghijk')`),'abcdefghijk');
  assert.equal(run(`videoId('https://youtu.be/abcdefghijk')`),'abcdefghijk');
  run(`jobs=[{id:'abcdefghijk',title:'A',status:'pending'},{id:'12345678901',title:'B',status:'pending'}];`);
  let calls=0;
  const data={video:{title:'<script>bad()</script>',channel:'Test'},summary:{total:2,positive:1,neutral:0,negative:1,positive_pct:50,neutral_pct:0,negative_pct:50},comments:[{id:'c1',author:'SECRET_AUTHOR',text:'<img src=x onerror=bad()>',sentiment:'positive',like_count:2}]};
  context.fetch=async()=>{calls++; if(calls===1)throw new Error('timeout');return{ok:true,json:async()=>data};};
  await run('runJobs()');
  assert.equal(run('jobs[0].status'),'error');
  assert.equal(run('jobs[1].status'),'done');
  await run('runJobs()');
  assert.equal(calls,3,'retry must skip completed video');
  assert.equal(run('jobs[0].status'),'done');
  run(`batchSource='Original source';source='Changed source';`);
  const html=run('reportHtml()');
  assert.ok(html.includes('Original source'));
  assert.ok(!html.includes('Changed source'));
  assert.ok(!html.includes('SECRET_AUTHOR'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('4 条评论'));
  run(`jobs[0].data.video.channel_id='creator'; jobs[0].data.comments = [
    {id:'reply',text:'Creator reply',sentiment:'positive',confidence:0.99,like_count:100,is_reply:true},
    {id:'owner',text:'Creator post',sentiment:'positive',confidence:0.99,like_count:99,author_channel_id:'creator'},
    {id:'low',text:'Uncertain',sentiment:'positive',confidence:0.5,like_count:90},
    ...Array.from({length:12},(_,i)=>({id:'viewer'+i,text:'Viewer comment '+i,sentiment:'positive',confidence:0.9,like_count:i})),
    {id:'duplicate',text:'Viewer comment 1',sentiment:'positive',confidence:0.9,like_count:1}
  ];`);
  assert.equal(run("representativeComments(jobs[0],'positive').length"),10);
  assert.equal(run("representativeComments(jobs[0],'positive')[0].id"),'viewer11');
  const evidence=run('evidenceHtml(jobs[0],true)');
  assert.ok(!evidence.includes('Creator reply'));
  assert.ok(!evidence.includes('Creator post'));
  assert.ok(!evidence.includes('Uncertain'));
  assert.ok(evidence.includes('展开其余 5 条'));
  element('detailDialog').showModal=()=>{element('detailDialog').open=true;};
  element('detailDialog').close=()=>{element('detailDialog').open=false;};
  element('batchRows').onclick({target:{closest:()=>({dataset:{detail:'0'}})}});
  assert.equal(element('detailDialog').open,true);
  assert.ok(element('modalDetail').innerHTML.includes('detailFrame'));
  element('closeDetail').onclick();assert.equal(element('detailDialog').open,false);
  console.log('Frontend checks passed: URL validation, partial failure, retry, batch provenance, report totals, escaping and author privacy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
