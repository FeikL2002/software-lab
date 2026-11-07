/** TEST ONLY. Not imported by any production function or build entry. */
import {makeDemo,DEMO_SPORTS} from './fixtures/demo.mjs';
process.env.ODDS_API_KEY='test-provider-key-not-valid';
process.env.OPENAI_API_KEY='test-model-key-not-valid';
process.env.PORT=process.env.PORT||'8889';
// Only intercept upstream providers. HTTP requests still execute the real app handlers.
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);
 if(u.hostname==='api.openai.com'){
  const {snapshot}=JSON.parse(JSON.parse(options.body).input);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:`SIMULATED AI TEST RESPONSE. ${snapshot.baseline}`}]}]});
 }
 if(u.hostname!=='api.the-odds-api.com')throw new Error('Test harness blocked an unexpected upstream host.');
 const headers={'x-requests-remaining':'450','x-requests-last':'1'};
 if(u.pathname.endsWith('/sports'))return Response.json(DEMO_SPORTS.map(s=>({...s,active:true,has_outrights:false})),{headers});
 const league=u.pathname.split('/')[3];
 if(u.pathname.endsWith('/odds'))return Response.json(makeDemo(league,u.searchParams.get('markets')||'h2h').events,{headers});
 if(u.pathname.endsWith('/events'))return Response.json(makeDemo(league).events.map(({bookmakers,...e})=>e),{headers});
 if(u.pathname.endsWith('/scores'))return Response.json(makeDemo(league).events.map(e=>({id:e.id,completed:false,scores:e.scores,last_update:e.scoreUpdatedAt})),{headers});
 throw new Error('Unexpected test provider path.');
};
await import('../scripts/dev.mjs');
