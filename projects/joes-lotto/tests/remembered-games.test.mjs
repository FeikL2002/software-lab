import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
// Execute the app's real version-1 import validator, without browser startup.
const validator=source.slice(source.indexOf('function validate(raw)'),source.indexOf('\nlet state='));
const context=vm.createContext({defaults:()=>({version:1,settings:{monthlyLimit:null,paused:false},tickets:[],stores:[],scratch:[],favorites:[],deliveryNotes:[],scanGameMatches:[]}),amountOK:v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid amount');return v;},dateOK:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T12:00:00Z')),statusNames:{pending:'Not checked'},short:(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Invalid text');return v;},validQuantity:v=>{if(!Number.isSafeInteger(v)||v<1)throw Error('Invalid quantity');return v;},validFingerprint:v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error('Invalid fingerprint');return v;}});
vm.runInContext(validator+'\nglobalThis.check=validate;',context);
const legacy=()=>({version:1,settings:{monthlyLimit:null,paused:false},tickets:[{id:'legacy-1',date:'2026-10-14',game:'Scratch-off',detail:'Existing ticket',store:'',cost:200,status:'pending',amount:0,deadline:'',notes:''}],stores:[],scratch:[],favorites:[]});
test('old version-1 backups load without product memory or new ticket fields',()=>{
 const result=context.check(legacy());assert.equal(result.tickets.length,1);assert.equal(result.tickets[0].cost,200);assert.equal(result.scanGameMatches.length,0);
});
test('remembered product choices preserve only hash, game number and confirmation date',()=>{
 const input=legacy();input.scanGameMatches=[{fingerprint:'a'.repeat(64),gameNumber:'1118',confirmedAt:'2026-10-19',rawValue:'must-not-survive',price:999999}];
 const result=context.check(input),m=result.scanGameMatches[0];assert.deepEqual(Object.keys(m).sort(),['confirmedAt','fingerprint','gameNumber']);assert.equal(m.gameNumber,'1118');assert.equal(result.tickets[0].cost,200);
});
test('malformed or duplicate remembered choices cannot silently replace a backup',()=>{
 const valid={fingerprint:'a'.repeat(64),gameNumber:'1118',confirmedAt:'2026-10-19'};
 for(const rows of [[{...valid,fingerprint:'raw-barcode'}],[{...valid,gameNumber:'99999'}],[valid,valid],Array(1001).fill(valid),[{...valid,confirmedAt:'not-a-date'}]]){
  assert.throws(()=>context.check({...legacy(),scanGameMatches:rows}));
 }
});
