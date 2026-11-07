/** Private server-only Postgres repository. Every ownership predicate comes from verified Identity. */
import {createHash} from 'node:crypto';
import {AppError,env} from './common.mjs';
import {validateBet,cents} from '../public/lib/bets.mjs';
let database;
async function db(){
 if(!env('NETLIFY_DB_URL').trim())throw new AppError('Cloud storage is not configured for this preview. Browser saves remain on this device.',503,'STORAGE_NOT_READY');
 try{if(!database){const {getDatabase}=await import('@netlify/database');database=getDatabase();}return database;}catch{throw new AppError('Cloud storage is unavailable. No change was confirmed.',503,'STORAGE_UNAVAILABLE');}
}
export async function databaseQuery(query,parameters=[]){try{return await(await db()).sql.unsafe(query,parameters);}catch(error){if(error instanceof AppError)throw error;throw new AppError('Cloud storage could not complete this request. No change was confirmed; refresh before retrying.',503,'STORAGE_UNAVAILABLE');}}
const defaultName=id=>'Scout '+createHash('sha256').update(String(id)).digest('hex').slice(0,8);
export function validateDisplayName(value){
 const name=typeof value==='string'?value.trim().normalize('NFKC'):'';
 if(!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u.test(name))throw new AppError('Use a public name of 1–32 letters, numbers, spaces, periods, underscores or hyphens. Do not use your email.',400,'BAD_DISPLAY_NAME');
 return name;
}
export function publicProfile(row,userId){return {displayName:row?.display_name||defaultName(userId),winningsPublic:row?.winnings_public===true};}
function financialColumns(record){return [record.status,record.stake===null?null:cents(record.stake),record.returnAmount===null?null:cents(record.returnAmount)];}
export function assertSnapshotUnchanged(previous,record){if(['mode','savedAt','sourceKey','quotedDecimal'].some(k=>previous[k]!==record[k])||JSON.stringify(previous.legs)!==JSON.stringify(record.legs))throw new AppError('The original saved snapshot cannot be changed. Record accepted prices separately.',400,'SNAPSHOT_IMMUTABLE');}
function validatedRow(row){return {...validateBet(row.record),_version:Number(row.version)};}
function count(value){const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0)throw new AppError('The stored totals cannot be displayed safely.',503,'TOTALS_UNAVAILABLE');return n;}
function cash(value){return count(value)/100;}
export function summaryFromRow(row={}){
 const settledStake=cash(row.settled_stake),totalReturned=cash(row.total_returned);
 return {saved:count(row.saved),open:count(row.open),settled:count(row.settled),won:count(row.won),lost:count(row.lost),settledStake,totalReturned,net:(count(row.total_returned)-count(row.settled_stake))/100,openStake:cash(row.open_stake),winningProfit:(count(row.won_returns)-count(row.won_stakes))/100,roi:settledStake>0?(totalReturned-settledStake)/settledStake*100:null};
}
const summarySQL=`COUNT(*) FILTER (WHERE b.status='saved') AS saved, COUNT(*) FILTER (WHERE b.status='open') AS open,
 COUNT(*) FILTER (WHERE b.status IN ('won','lost','push','void','cashout')) AS settled, COUNT(*) FILTER (WHERE b.status='won') AS won, COUNT(*) FILTER (WHERE b.status='lost') AS lost,
 COALESCE(SUM(b.stake_cents) FILTER (WHERE b.status IN ('won','lost','push','void','cashout')),0) AS settled_stake,
 COALESCE(SUM(b.return_cents) FILTER (WHERE b.status IN ('won','lost','push','void','cashout')),0) AS total_returned,
 COALESCE(SUM(b.stake_cents) FILTER (WHERE b.status='open'),0) AS open_stake,
 COALESCE(SUM(b.stake_cents) FILTER (WHERE b.status='won'),0) AS won_stakes, COALESCE(SUM(b.return_cents) FILTER (WHERE b.status='won'),0) AS won_returns`;
export const socialRepository={
 async profile(userId){const rows=await databaseQuery('SELECT display_name,winnings_public FROM oddsscout_profiles WHERE user_id=$1',[userId]);return publicProfile(rows[0],userId);},
 async updateProfile(userId,{displayName,winningsPublic}){
  const name=validateDisplayName(displayName);if(typeof winningsPublic!=='boolean')throw new AppError('Choose whether to share your self-reported totals.',400,'BAD_PRIVACY_SETTING');
  const rows=await databaseQuery(`INSERT INTO oddsscout_profiles(user_id,display_name,winnings_public) VALUES($1,$2,$3)
   ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,winnings_public=EXCLUDED.winnings_public,updated_at=NOW() RETURNING display_name,winnings_public`,[userId,name,winningsPublic]);return publicProfile(rows[0],userId);
 },
 async listBets(userId,offset){const rows=await databaseQuery('SELECT record,version FROM oddsscout_bets WHERE user_id=$1 ORDER BY created_at DESC,id DESC OFFSET $2 LIMIT 100',[userId,offset]);return {records:rows.map(validatedRow),nextOffset:rows.length===100?offset+100:null};},
 async createBet(userId,record){
  const rows=await databaseQuery(`INSERT INTO oddsscout_bets(id,user_id,record,status,stake_cents,return_cents) VALUES($1,$2,$3::jsonb,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING record,version`,[record.id,userId,JSON.stringify(record),...financialColumns(record)]);
  if(!rows.length)throw new AppError('This saved record already exists. Refresh My Bets.',409,'RECORD_CONFLICT');return validatedRow(rows[0]);
 },
 async updateBet(userId,record,version){
  const previous=await databaseQuery('SELECT record,version FROM oddsscout_bets WHERE id=$1 AND user_id=$2',[record.id,userId]);
  if(!previous.length||Number(previous[0].version)!==version)throw new AppError('This record changed on another device. Refresh My Bets before editing again.',409,'RECORD_CONFLICT');
  assertSnapshotUnchanged(validateBet(previous[0].record),record);
  const rows=await databaseQuery(`UPDATE oddsscout_bets SET record=$1::jsonb,status=$2,stake_cents=$3,return_cents=$4,version=version+1,updated_at=NOW() WHERE id=$5 AND user_id=$6 AND version=$7 RETURNING record,version`,[JSON.stringify(record),...financialColumns(record),record.id,userId,version]);
  if(!rows.length)throw new AppError('Another device changed this record. Refresh before retrying.',409,'RECORD_CONFLICT');return validatedRow(rows[0]);
 },
 async deleteBet(userId,id,version){const rows=await databaseQuery('DELETE FROM oddsscout_bets WHERE id=$1 AND user_id=$2 AND version=$3 RETURNING id',[id,userId,version]);if(!rows.length)throw new AppError('The record changed or is no longer available. Refresh My Bets.',409,'RECORD_CONFLICT');},
 async trending(){const rows=await databaseQuery(`SELECT selection_hash,MAX(title) AS title,COUNT(*)::integer AS likes,MAX(created_at) AS latest_like FROM oddsscout_likes GROUP BY selection_hash ORDER BY likes DESC,latest_like DESC LIMIT 30`);return rows.map(r=>({...r,likes:count(r.likes)}));},
 async like(userId,{hash,eventId,title}){await databaseQuery('INSERT INTO oddsscout_likes(selection_hash,user_id,event_id,title) VALUES($1,$2,$3,$4) ON CONFLICT(selection_hash,user_id) DO NOTHING',[hash,userId,eventId,title]);},
 async unlike(userId,hash){await databaseQuery('DELETE FROM oddsscout_likes WHERE selection_hash=$1 AND user_id=$2',[hash,userId]);},
 async winnings(userId){
  const [ownRows,communityRows,leaders,profile]=await Promise.all([
   databaseQuery(`SELECT ${summarySQL} FROM oddsscout_bets b WHERE b.user_id=$1`,[userId]),
   databaseQuery(`SELECT COUNT(DISTINCT p.user_id) FILTER (WHERE b.status IN ('won','lost','push','void','cashout')) AS participants,${summarySQL} FROM oddsscout_profiles p JOIN oddsscout_bets b ON b.user_id=p.user_id WHERE p.winnings_public=TRUE AND b.status IN ('won','lost','push','void','cashout')`),
   databaseQuery(`SELECT p.display_name,${summarySQL} FROM oddsscout_profiles p JOIN oddsscout_bets b ON b.user_id=p.user_id WHERE p.winnings_public=TRUE AND b.status IN ('won','lost','push','void','cashout') GROUP BY p.user_id,p.display_name ORDER BY (COALESCE(SUM(b.return_cents),0)-COALESCE(SUM(b.stake_cents),0)) DESC,p.display_name ASC LIMIT 20`),
   this.profile(userId)
  ]);
  // Public summaries expose settled USD totals only, with no private saved ideas, pending stakes, record IDs or contact data.
  const publicSummary=row=>{const {settled,won,lost,settledStake,totalReturned,net,roi}=summaryFromRow(row);return {settled,won,lost,settledStake,totalReturned,net,roi};};
  return {own:summaryFromRow(ownRows[0]),profile,community:{participants:count(communityRows[0]?.participants),summary:publicSummary(communityRows[0]),leaderboard:leaders.map(row=>({displayName:row.display_name,...publicSummary(row)}))}};
 },
 async messages(userId,before){
  const rows=await databaseQuery(`SELECT m.id,m.user_id,m.body,m.created_at,COALESCE(p.display_name,'Scout ' || SUBSTRING(ENCODE(SHA256(CONVERT_TO(m.user_id,'UTF8')),'hex'),1,8)) AS display_name FROM oddsscout_chat m LEFT JOIN oddsscout_profiles p ON p.user_id=m.user_id WHERE m.deleted_at IS NULL ${before?'AND (m.created_at,m.id)<($1::timestamptz,$2::uuid)':''} ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,before?[before.createdAt,before.id]:[]);
  const page=rows.slice(0,50),oldest=page.at(-1),nextCursor=rows.length>50&&oldest?encodeChatCursor(oldest):null;
  return {messages:page.reverse().map(r=>chatMessage(r,userId)),nextCursor};
 },
 async createMessage(userId,body){
  let client;const profile=await this.profile(userId);
  try{
   client=await(await db()).pool.connect();await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['oddsscout-chat:'+userId]);
   const limit=await client.query(`SELECT COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '10 seconds')::integer AS burst,COUNT(*)::integer AS hourly FROM oddsscout_chat WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 hour'`,[userId]);
   if(Number(limit.rows[0].burst)>=5||Number(limit.rows[0].hourly)>=60)throw new AppError('Chat cooldown: send at most 5 messages per 10 seconds and 60 per hour.',429,'CHAT_COOLDOWN',60);
   const result=await client.query('INSERT INTO oddsscout_chat(user_id,body) VALUES($1,$2) RETURNING id,user_id,body,created_at',[userId,body]);
   await client.query('COMMIT');return chatMessage({...result.rows[0],display_name:profile.displayName},userId);
  }catch(error){if(client)try{await client.query('ROLLBACK');}catch{/* Keep the original safe error. */}if(error instanceof AppError)throw error;throw new AppError('Chat could not save this message. Refresh before retrying.',503,'CHAT_UNAVAILABLE');}finally{client?.release();}
 },
 async deleteMessage(userId,id){const rows=await databaseQuery('UPDATE oddsscout_chat SET deleted_at=NOW(),body=\'\' WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id',[id,userId]);if(!rows.length)throw new AppError('This message is unavailable or belongs to another member.',404,'MESSAGE_UNAVAILABLE');},
 async reportMessage(userId,id,reason){const rows=await databaseQuery(`INSERT INTO oddsscout_chat_reports(message_id,user_id,reason) SELECT id,$2,$3 FROM oddsscout_chat WHERE id=$1 AND deleted_at IS NULL ON CONFLICT(message_id,user_id) DO NOTHING RETURNING message_id`,[id,userId,reason]);return rows.length>0;}
};
export function chatMessage(row,userId){return {id:row.id,authorKey:createHash('sha256').update(String(row.user_id)).digest('hex').slice(0,24),displayName:row.display_name,body:row.body,createdAt:new Date(row.created_at).toISOString(),own:row.user_id===userId};}
export function encodeChatCursor(row){return Buffer.from(JSON.stringify({id:row.id,createdAt:new Date(row.created_at).toISOString()})).toString('base64url');}
export function decodeChatCursor(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>200||!/^[A-Za-z0-9_-]+$/.test(value))throw new AppError('Invalid chat page.',400,'BAD_CURSOR');
 try{const parsed=JSON.parse(Buffer.from(value,'base64url').toString());if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)||typeof parsed.createdAt!=='string'||!Number.isFinite(Date.parse(parsed.createdAt)))throw 0;return {id:parsed.id,createdAt:new Date(parsed.createdAt).toISOString()};}catch{throw new AppError('Invalid chat page.',400,'BAD_CURSOR');}
}
export function validateChatBody(value){const body=typeof value==='string'?value.trim().normalize('NFC'):'';if(!body||body.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))throw new AppError('Write a plain-text message of 1–1,000 characters.',400,'BAD_MESSAGE');return body;}

// Test cleanup only. There is no HTTP route that can close or replace the database.
export async function closeSocialDatabaseForTests(){if(database){await database.pool.end();database=undefined;}}
