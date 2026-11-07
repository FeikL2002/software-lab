import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const [drawSource, deskSource, appSource] = await Promise.all(['draw-ticket.js', 'ticket-desk.js', 'app.js'].map(name => readFile(new URL('../dist/' + name, import.meta.url), 'utf8')));
const copy = value => JSON.parse(JSON.stringify(value));
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
const draw = (extra = {}) => ({game:'Powerball',jurisdiction:'OH',drawDates:['2026-10-26'],session:null,plays:[{label:'A',numbers:[1,2,3,4,5],bonus:6}],powerPlay:false,doublePlay:false,reviewed:false,...extra});
const row = (extra = {}) => ({ticketId:'ticket-1',scannedAt:'2026-10-28T14:00:00.000Z',source:'photo',format:'UPC-A',referenceHash:null,imageHash:hashB,imageId:null,imageError:'',draw:draw(),evaluation:null,noticeKey:'',refreshError:false,...extra});
function setup({scans = [], imageSave, metadataSave, notifications=false, notificationPermission='granted', fetch: fetcher} = {}) {
  let savedScans = copy(scans);
  const ticketRows = [{id:'ticket-1',game:'Powerball',cost:200,status:'pending',amount:0}];
  const calls = [], removed = [], toasts = [], notices = [];
  function NotificationStub(title,options){notices.push({channel:'browser',title,options:copy(options)});}
  NotificationStub.permission=notificationPermission;
  const bridge = {
    scans: () => copy(savedScans), tickets: () => copy(ticketRows), get: id => copy(ticketRows.find(t => t.id === id) || null),
    saveScan(value) { const cleaned = context.window.JoeTicketDesk.validateDetails([value], ticketRows.map(t => t.id))[0]; savedScans = savedScans.filter(r => r.ticketId !== value.ticketId); savedScans.push(copy(cleaned)); calls.push(copy(cleaned)); return typeof metadataSave === 'function' ? metadataSave(cleaned,calls.length) : metadataSave ?? true; },
    refresh() {}, notifications: () => notifications, toast: message => toasts.push(message),
  };
  const context = vm.createContext({window:{Notification:NotificationStub,JoeTicketsBridge:bridge,JoeTicketImages:{save:imageSave || (async () => ({imageId:'photo-1'})),remove:async id=>removed.push(id)}},document:{readyState:'loading',hidden:false,baseURI:'https://example.invalid/',addEventListener(){},getElementById(){return null;}},URL,Blob,Date,Intl,AbortSignal,btoa,crypto:{...webcrypto,randomUUID},navigator:{serviceWorker:{getRegistration:async()=>({showNotification:async(title,options)=>notices.push({channel:'service-worker',title,options:copy(options)})})}},Notification:NotificationStub,fetch:fetcher || (async()=>{throw Error('No fetch expected');}),setInterval(){},console});
  vm.runInContext(drawSource, context); vm.runInContext(deskSource, context);
  return {api:context.window.JoeTicketDesk,context,calls,removed,toasts,notices,ticketRows,read:()=>copy(savedScans),replace:value=>{savedScans=copy(value);}};
}
function appValidator(harness) {
  const prefix = appSource.slice(0, appSource.indexOf('let state=defaults()'));
  vm.runInContext(prefix + '\nwindow.testAppValidate=validate;', harness.context);
  return value => copy(harness.context.window.testAppValidate(value));
}
function legacyBackup() { return {version:1,settings:{monthlyLimit:null,paused:false},tickets:[{id:'ticket-1',date:'2026-10-27',game:'Scratch-off',detail:'Existing game',store:'Existing store',cost:500,status:'pending',amount:0,deadline:'',notes:'Keep existing data'}],stores:[],scratch:[],favorites:[]}; }

test('old v1 backups without scan metadata retain tickets and gain an empty compatible collection', () => {
  const h = setup(), validate = appValidator(h), before = legacyBackup(), restored = validate(before);
  assert.deepEqual(restored.tickets, before.tickets); assert.deepEqual(restored.ticketScans, []);
  assert.deepEqual(restored.scanGameMatches, []); assert.equal(restored.settings.resultsNotifications, false);
  assert.deepEqual(copy(h.api.validateDetails([], ['ticket-1'])), []);
});

test('scan detail validation drops raw serials, OCR, credentials and unknown draw keys', () => {
  const h=setup();
  const clean=copy(h.api.validateDetails([row({referenceHash:hashA,rawSerial:'private',rawText:'private',imageBlob:'private',officiallyVerified:true,draw:{...draw(),barcode:'private',rawText:'private'}})],['ticket-1']))[0];
  assert.equal(clean.referenceHash,hashA);assert.equal(clean.imageHash,hashB);
  for(const key of ['rawSerial','rawText','imageBlob','officiallyVerified'])assert.equal(clean[key],undefined);
  assert.equal(clean.draw.barcode,undefined);assert.equal(clean.draw.rawText,undefined);assert.equal(clean.draw.reviewed,false);
});

test('backup rows cannot assert official validation or place potential winnings into ticket cash', () => {
  const h=setup(), base={status:'potential-winner',officiallyVerified:false,potentialCents:400,reason:'potential-prize-match',checkedAt:'2026-10-28T14:00:00Z',sourceURLs:['https://www.ohiolottery.com/winning-numbers/winning-numbers-archive']};
  for(const evaluation of [{...base,officiallyVerified:true},{...base,status:'official-winner'},{...base,status:'officially-verified-loser'},{...base,potentialCents:-1},{...base,potentialCents:1.5},{...base,checkedAt:'not-a-date'}])assert.throws(()=>h.api.validateDetails([row({evaluation})],['ticket-1']));
  const clean=copy(h.api.validateDetails([row({evaluation:{...base,amount:500000,rawResult:'private',sourceURLs:[...base.sourceURLs,'https://attacker.test/results','javascript:alert(1)']}})],['ticket-1']))[0];
  assert.equal(clean.evaluation.officiallyVerified,false);assert.equal(clean.evaluation.amount,undefined);assert.equal(clean.evaluation.rawResult,undefined);
  assert.equal(clean.evaluation.sourceURLs.length,1);assert.equal(h.ticketRows[0].amount,0);assert.equal(h.ticketRows[0].status,'pending');
});

test('malformed hashes, photo references, draw numbers and duplicate/missing metadata IDs are rejected', () => {
  const h=setup();
  for(const referenceHash of ['a'.repeat(63),'A'.repeat(64),'raw barcode',123,{}, {toString:()=>hashA}])assert.throws(()=>h.api.validateDetails([row({referenceHash})],['ticket-1']));
  for(const imageId of ['../private','data:image/jpeg;base64,abc','photo with spaces',42,{}])assert.throws(()=>h.api.validateDetails([row({imageId})],['ticket-1']));
  for(const badDraw of [{...draw(),plays:[{numbers:[1,1,3,4,5],bonus:6}]},{...draw(),drawDates:['2026-02-30']},{...draw(),plays:[{numbers:[1,2,3,4,5],bonus:27}]}])assert.throws(()=>h.api.validateDetails([row({draw:badDraw})],['ticket-1']));
  assert.throws(()=>h.api.validateDetails([row(),row()],['ticket-1']));assert.throws(()=>h.api.validateDetails([row()],['other-ticket']));
  assert.throws(()=>h.api.validateDetails(Array.from({length:20001},()=>row()),['ticket-1']));
  assert.throws(()=>h.api.validateDetails([row({draw:{...draw(),plays:Array.from({length:31},()=>({numbers:[1,2,3,4,5],bonus:6}))}})],['ticket-1']));
});

test('duplicate checks use private physical-reference or exact-image hashes, never a shared UPC', () => {
  const h=setup({scans:[row({referenceHash:hashA,imageHash:hashB})]});
  assert.equal(h.api.findDuplicate({referenceHash:hashA}), 'ticket-1');assert.equal(h.api.findDuplicate({imageHash:hashB}), 'ticket-1');
  assert.equal(h.api.findDuplicate({productFingerprint:hashA,fingerprint:hashA,format:'UPC-A'}),null);
  assert.equal(h.api.findDuplicate({referenceHash:'c'.repeat(64),imageHash:'d'.repeat(64)}),null);
});

test('image save failure preserves immediate metadata and the purchase record', async () => {
  const h=setup({imageSave:async()=>{throw Error('quota');}}),detail={source:'photo',format:'OCR',imageHash:hashB,drawData:draw(),imageBlob:new Blob(['private fixture'],{type:'image/jpeg'})};
  const promise=h.api.capture(h.ticketRows[0],detail);
  assert.equal(h.read().length,1);assert.equal(h.read()[0].ticketId,'ticket-1');assert.equal(h.ticketRows[0].cost,200);
  await promise;const saved=h.read()[0];assert.equal(saved.imageId,null);assert.match(saved.imageError,/Photo could not be saved/);assert.equal(saved.draw.reviewed,false);assert.equal(detail.imageBlob,null);assert.equal(h.ticketRows[0].cost,200);
});

test('a late image save must preserve draw details reviewed while the write was pending', async () => {
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});
  const h=setup({imageSave:()=>waiting}),detail={source:'photo',imageHash:hashB,drawData:draw(),imageBlob:new Blob(['private fixture'])};
  const pending=h.api.capture(h.ticketRows[0],detail);
  h.replace([row({draw:draw({reviewed:true,powerPlay:true}),evaluation:{status:'pending',officiallyVerified:false,potentialCents:null,reason:'official-results-unavailable'}})]);
  finish({imageId:'photo-late'});await pending;
  assert.equal(h.read()[0].draw.reviewed,true);assert.equal(h.read()[0].draw.powerPlay,true);assert.equal(h.read()[0].imageId,'photo-late');
});

test('deleted tickets do not reappear when a private photo write finishes', async () => {
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});const h=setup({imageSave:()=>waiting}),detail={source:'camera',imageBlob:new Blob(['fixture'])};
  const pending=h.api.capture(h.ticketRows[0],detail);h.ticketRows.splice(0);h.replace([]);finish({imageId:'deleted-photo'});await pending;
  assert.equal(h.read().length,0);assert.deepEqual(h.removed,['deleted-photo']);
});

test('a late result response must preserve a private photo saved while fetching', async () => {
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});
  const h=setup({scans:[row({draw:draw({reviewed:true})})],fetch:()=>waiting});
  const pending=h.api.checkTicket('ticket-1',{quiet:true});h.replace([row({draw:draw({reviewed:true}),imageId:'photo-during-check'})]);
  finish({ok:true,json:async()=>({status:'fresh',stale:false,records:[{game:'Powerball',drawDate:'2026-10-26',session:null,numbers:[1,2,3,4,5],bonus:6,multiplier:3,sourceURL:'https://www.ohiolottery.com/winning-numbers/winning-numbers-archive',official:true,approved:true}]})});
  await pending;assert.equal(h.read()[0].imageId,'photo-during-check');assert.equal(h.read()[0].evaluation.status,'potential-winner');assert.equal(h.ticketRows[0].amount,0);
});

test('edited draw rows do not receive obsolete results and unreviewed rows cannot fetch', async () => {
  let finish,fetchCount=0;const waiting=new Promise(resolve=>{finish=resolve;});
  const h=setup({scans:[row({draw:draw({reviewed:true})})],fetch:()=>{fetchCount++;return waiting;}});
  const pending=h.api.checkTicket('ticket-1',{quiet:true});h.replace([row({draw:draw({reviewed:true,drawDates:['2026-10-28']})})]);
  finish({ok:true,json:async()=>({records:[]})});await pending;assert.equal(h.read()[0].evaluation,null);assert.deepEqual(h.read()[0].draw.drawDates,['2026-10-28']);
  h.replace([row()]);await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(fetchCount,1);assert.equal(h.read()[0].evaluation,null);
});

test('records-only restore removes stale comparisons and missing photos without inventing validation', async () => {
  const h=setup();const restored=copy(await h.api.restoreImages([row({imageId:'old-photo',evaluation:{status:'potential-winner'},noticeKey:'old',refreshError:true})],[]));
  assert.equal(restored[0].imageId,null);assert.equal(restored[0].evaluation,null);assert.equal(restored[0].noticeKey,'');assert.equal(restored[0].refreshError,false);assert.match(restored[0].imageError,/did not include/);
  assert.throws(()=>h.api.validateDetails([row({evaluation:{status:'verified-winner',officiallyVerified:true}})],['ticket-1']));
});

test('failed initial metadata persistence keeps photos in memory, skips durable writes and exports a linked portable backup', async () => {
  let durableWrites=0;
  const fixture='private quota photo fixture';
  const h=setup({metadataSave:false,imageSave:async()=>{durableWrites++;return {imageId:'must-not-write'};}});
  const detail={source:'photo',imageHash:hashB,drawData:draw(),imageBlob:new Blob([fixture],{type:'image/jpeg'})};
  await h.api.capture(h.ticketRows[0],detail);
  assert.equal(durableWrites,0);assert.equal(detail.imageBlob,null);assert.equal(h.read()[0].imageId,null);
  assert.match(h.read()[0].imageError,/memory only/);assert.equal(h.ticketRows[0].cost,200);
  const bundle=copy(await h.api.exportData(true));
  assert.equal(bundle.scans.length,1);assert.equal(bundle.images.length,1);
  assert.ok(bundle.scans[0].imageId);assert.equal(bundle.scans[0].imageId,bundle.images[0].id);
  assert.notEqual(bundle.scans[0].imageId,'must-not-write');
  assert.match(bundle.images[0].dataUrl,/^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(bundle.images[0].dataUrl.split(',')[1],'base64').toString(),fixture);
  assert.equal(h.read()[0].imageId,null,'portable export must not fabricate a durable image link');
  const recordsOnly=copy(await h.api.exportData(false));
  assert.deepEqual(recordsOnly.images,[]);assert.equal(recordsOnly.scans[0].imageId,null);
});

test('a photo whose durable ID cannot be persisted is removed and remains recoverable through a linked memory backup', async () => {
  let durableWrites=0;
  const fixture='private photo after metadata quota';
  const h=setup({metadataSave:(_row,call)=>call===1,imageSave:async()=>{durableWrites++;return {imageId:'orphan-photo'};}});
  const detail={source:'camera',referenceHash:hashA,drawData:draw(),imageBlob:new Blob([fixture],{type:'image/jpeg'})};
  await h.api.capture(h.ticketRows[0],detail);
  assert.equal(durableWrites,1);assert.deepEqual(h.removed,['orphan-photo']);assert.equal(detail.imageBlob,null);
  const saved=h.read()[0];assert.equal(saved.imageId,null);assert.equal(saved.referenceHash,hashA);assert.match(saved.imageError,/memory only/);
  assert.equal(h.ticketRows[0].cost,200);assert.equal(h.ticketRows[0].amount,0);
  const bundle=copy(await h.api.exportData(true));
  assert.equal(bundle.images.length,1);assert.equal(bundle.scans[0].imageId,bundle.images[0].id);assert.notEqual(bundle.images[0].id,'orphan-photo');
  assert.equal(Buffer.from(bundle.images[0].dataUrl.split(',')[1],'base64').toString(),fixture);
  assert.equal(h.read()[0].imageId,null);
});

const approvedPowerball=(extra={})=>({game:'Powerball',drawDate:'2026-10-26',session:null,numbers:[1,2,3,4,5],bonus:6,multiplier:3,sourceURL:'https://www.ohiolottery.com/winning-numbers/winning-numbers-archive',official:true,approved:true,...extra});
const publishedResponse=records=>({ok:true,json:async()=>({status:'fresh',stale:false,records})});

test('winner and loser comparisons send only a private results-availability notice once',async()=>{
  for(const winning of [true,false]){
    const h=setup({notifications:true,scans:[row({draw:draw({reviewed:true,plays:[{label:'A',numbers:winning?[1,2,3,4,5]:[11,12,13,14,15],bonus:7}]})})],fetch:async()=>publishedResponse([approvedPowerball()])});
    await h.api.checkTicket('ticket-1',{quiet:true});
    assert.equal(h.read()[0].evaluation.status,winning?'potential-winner':'potential-loser');
    assert.equal(h.notices.length,1);assert.equal(h.notices[0].channel,'service-worker');
    assert.equal(h.notices[0].title,'Your Powerball results are available.');
    assert.equal(h.notices[0].options.body,'Open Joe’s Lotto to check your ticket.');
    assert.equal(h.notices[0].options.tag,'joe-results-ticket-1');
    assert.deepEqual(h.notices[0].options.data,{ticketId:'ticket-1'});
    const visibleText=h.notices[0].title+' '+h.notices[0].options.body;
    assert.doesNotMatch(visibleText,/\b(?:won|win|winner|loser|prize|million)\b|\$|\d/i);
    assert.equal(h.read()[0].noticeKey,'Powerball:2026-10-26:');
    await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,1);
    assert.equal(h.ticketRows[0].amount,0);assert.equal(h.ticketRows[0].status,'pending');
  }
});

test('disabled or denied notifications show no system notice and do not consume the notice key',async()=>{
  for(const options of [{notifications:false},{notifications:true,notificationPermission:'denied'}]){
    const h=setup({...options,scans:[row({draw:draw({reviewed:true})})],fetch:async()=>publishedResponse([approvedPowerball()])});
    await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,0);assert.equal(h.read()[0].noticeKey,'');
    assert.equal(h.read()[0].evaluation.status,'potential-winner');
  }
});

test('unapproved, unofficial, stale, mismatched or missing results never trigger availability notices',async()=>{
  const fixtures=[[],[approvedPowerball({approved:false})],[approvedPowerball({official:false})],[approvedPowerball({stale:true})],[approvedPowerball({game:'Mega Millions'})],[approvedPowerball({drawDate:'2026-10-28'})],[approvedPowerball({sourceURL:'https://attacker.test/official-results'})],[approvedPowerball({numbers:[1,1,3,4,5]})]];
  for(const records of fixtures){
    const h=setup({notifications:true,scans:[row({draw:draw({reviewed:true})})],fetch:async()=>publishedResponse(records)});
    await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,0,JSON.stringify(records));assert.equal(h.read()[0].noticeKey,'');
  }
  const picked=draw({game:'Pick 3',reviewed:true,session:'midday',plays:[{label:'A',numbers:[0,1,2],bonus:null,stakeCents:50,playType:'straight'}]});
  const h=setup({notifications:true,scans:[row({draw:picked})],fetch:async()=>publishedResponse([approvedPowerball({game:'Pick 3',session:'evening',numbers:[0,1,2],bonus:null,multiplier:null})])});
  await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,0);assert.equal(h.read()[0].evaluation.status,'pending');
});

test('multi-draw notices wait until every saved draw has an approved result',async()=>{
  let allPublished=false;
  const h=setup({notifications:true,scans:[row({draw:draw({reviewed:true,drawDates:['2026-10-26','2026-10-28']})})],fetch:async url=>{
    const date=new URL(url).searchParams.get('date');
    return publishedResponse(date==='2026-10-26'||allPublished?[approvedPowerball({drawDate:date})]:[]);
  }});
  await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,0);assert.equal(h.read()[0].noticeKey,'');
  allPublished=true;await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,1);assert.equal(h.read()[0].noticeKey,'Powerball:2026-10-26,2026-10-28:');
  await h.api.checkTicket('ticket-1',{quiet:true});assert.equal(h.notices.length,1);
});

test('the browser notification fallback uses the same safe availability message',async()=>{
  const h=setup({notifications:true,scans:[row({draw:draw({reviewed:true})})],fetch:async()=>publishedResponse([approvedPowerball()])});
  h.context.navigator.serviceWorker=undefined;
  await h.api.checkTicket('ticket-1',{quiet:true});
  assert.equal(h.notices.length,1);assert.equal(h.notices[0].channel,'browser');
  assert.equal(h.notices[0].title,'Your Powerball results are available.');assert.equal(h.notices[0].options.body,'Open Joe’s Lotto to check your ticket.');
  assert.equal(h.read()[0].noticeKey,'Powerball:2026-10-26:');
});
