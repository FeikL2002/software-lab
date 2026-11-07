import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
const catalog=JSON.parse(await readFile(new URL('../dist/data/ohio-games.json',import.meta.url),'utf8'));
const code=await readFile(new URL('../dist/ticket-intelligence.js',import.meta.url),'utf8');
function intelligence(data=catalog){
 const context=vm.createContext({window:{crypto:webcrypto},document:{currentScript:{src:'https://example.invalid/ticket-intelligence.js'},baseURI:'https://example.invalid/'},URL,TextEncoder,fetch:async()=>({ok:true,json:async()=>structuredClone(data)})});
 vm.runInContext(code,context);return context.window.JoeTicketIntelligence;
}
test('all catalog mappings have exact unique checksum-valid product codes and bounded prices',async()=>{
 const seen=new Set(),numbers=new Set();
 for(const g of catalog.games){
  assert.ok(!numbers.has(g.gameNumber));numbers.add(g.gameNumber);
  assert.ok(Number.isSafeInteger(g.unitPriceCents)&&g.unitPriceCents>0&&g.unitPriceCents<=10000);
  for(const upc of g.upcCodes){
   assert.match(upc,/^\d{12}$/);assert.ok(!seen.has(upc));seen.add(upc);
   assert.equal([...upc].reduce((sum,d,i)=>sum+Number(d)*(i%2===0?3:1),0)%10,0);
   assert.equal(new URL(g.upcSource).hostname,'www.ohiolottery.com');
   const match=await intelligence().identify(upc,'UPC-A');
   assert.equal(match.gameNumber,g.gameNumber);assert.equal(match.unitPriceCents,g.unitPriceCents);
  }
 }
 assert.ok(seen.size>=57);
});
test('a known game wins over a validation code and an unrelated checksum-valid UPC',async()=>{
 const api=intelligence(),g=catalog.games.find(g=>g.gameNumber==='1012');assert.ok(g.upcCodes.length);
 const selected=await api.selectCandidate([{rawValue:'not-a-public-game-code',format:'PDF417'},{rawValue:'012345678905',format:'UPC-A'},{rawValue:g.upcCodes[0],format:'UPC-A'}]);
 assert.equal(selected.index,2);assert.equal(selected.gameMatch.gameNumber,'1012');
 assert.equal(await api.identify('012345678905','UPC-A'),null);
 assert.equal(await api.identify(g.upcCodes[0],'Code 128'),null);
});
test('two different recognized games require one ticket at a time',async()=>{
 const api=intelligence(),rows=catalog.games.filter(g=>g.upcCodes.length).slice(0,2);
 const selected=await api.selectCandidate(rows.map(g=>({rawValue:g.upcCodes[0],format:'UPC-A'})));
 assert.equal(selected.ambiguous,true);assert.equal(selected.gameMatch,null);
});
test('product memory hashes normalize UPC/EAN and never accept serial, invalid or non-product codes',async()=>{
 const api=intelligence(),upc=catalog.games.find(g=>g.upcCodes.length).upcCodes[0];
 const a=await api.productFingerprint(upc,'UPC-A'),b=await api.productFingerprint('0'+upc,'EAN-13');
 assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,b);
 assert.equal(await api.productFingerprint(upc,'Code128'),null);
 assert.equal(await api.productFingerprint(upc.slice(0,-1)+((Number(upc.at(-1))+1)%10),'UPC-A'),null);
 assert.equal(await api.productFingerprint('validation-serial','PDF417'),null);
});
test('older versions with repeated names stay separate by printed game number',async()=>{
 const api=intelligence();const rows=await api.search('Holiday Cash');assert.ok(rows.length>=2);
 assert.ok(rows.some(g=>g.catalogStatus==='historical-publication'));assert.ok(rows.some(g=>g.catalogStatus==='listed'));
 assert.equal(new Set(rows.map(g=>g.gameNumber)).size,rows.length);
});
