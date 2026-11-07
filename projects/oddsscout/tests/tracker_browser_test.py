"""v4 Chromium DOM flows. Providers, account service, browser storage, navigation and downloads are simulated.
This does not test a real Supabase project, physical iPhone, or sportsbook connection.
"""
from pathlib import Path
import re,json,base64,os,shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('TRACKER_TEST_OUTPUT',str(ROOT/'test-output/tracker')));OUT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'public/index.html').read_text();HTML=re.sub(r'<script\b[^>]*>.*?</script>','',HTML,flags=re.S);HTML=re.sub(r'<link\b[^>]*>','',HTML)
icon='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'public/icon.svg').read_bytes()).decode();HTML=HTML.replace('src="/icon.svg"',f'src="{icon}"').replace('</head>','<style>'+(ROOT/'public/styles.css').read_text()+'</style></head>')
SOURCES='\n'.join(re.sub(r'^import .*;\n','',(ROOT/'public'/f).read_text(),flags=re.M) for f in ['lib/odds.mjs','lib/board.mjs','lib/demo.mjs','lib/parlays.mjs','lib/bets.mjs','tracker-ui.mjs','research-ui.mjs','app.mjs'])
SOURCES=re.sub(r'\bexport\s+(?=const|function)','',SOURCES).replace("if(new URLSearchParams(location.search).get('demo')==='1')enterDemo();else bootstrap();","if(window.__scenario==='demo')enterDemo();else bootstrap();")
PRE=r'''
window.__store=window.__initial||{};window.__db={};window.__who=null;window.__requests=[];
const storage={getItem:k=>window.__store[k]??null,setItem:(k,v)=>{if(window.__storageFail)throw new Error('quota');window.__store[k]=String(v);},removeItem:k=>delete window.__store[k]};
Object.defineProperty(window,'localStorage',{value:storage,configurable:true});Object.defineProperty(window,'sessionStorage',{value:storage,configurable:true});Object.defineProperty(navigator,'onLine',{get:()=>!window.__offline,configurable:true});
window.confirm=()=>true;
const create=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.__csv=blob;return create.call(URL,blob);};
const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)return;return click.call(this);};
window.fetch=async(path,options={})=>{
 window.__requests.push(path);if(window.__offline)throw new TypeError('offline');
 const u=new URL(path,'https://example.test'),b=options.body?JSON.parse(options.body):{},method=options.method||'GET';
 if(u.pathname==='/api/config')return Response.json({apiVersion:2,allLeaguesAvailable:true,oddsConfigured:true,aiEnabled:false,configuredBooks:DEFAULT_BOOKS});
 if(u.pathname==='/api/sports')return Response.json({sports:DEMO_SPORTS});
 if(u.pathname==='/api/board'){const d=makeDemo(u.searchParams.get('league'),u.searchParams.get('market')||'h2h');d.mode='live';d.source='SIMULATED PROVIDER';d.batch={totalLeagues:DEMO_SPORTS.length,loaded:DEMO_SPORTS,failed:[],nextPage:null};return Response.json(d);}
 if(u.pathname==='/api/account'){
  const user=()=>window.__who?{id:window.__who,email:window.__who+'@example.test'}:null;
  if(b.action==='login'){window.__who=b.email.split('@')[0];window.__db[window.__who]??=[];return Response.json({configured:true,user:user()});}
  if(b.action==='logout'){window.__who=null;return Response.json({configured:true,user:null});}
  if(b.action==='signup')return Response.json({configured:true,user:null,message:'Check your email to confirm.'});
  if(b.action==='recover')return Response.json({message:'If this email has an account, a recovery email will be sent.'});
  return Response.json({configured:window.__scenario!=='no-accounts',user:user()});
 }
 if(u.pathname==='/api/my-bets'){
  if(!window.__who)return Response.json({error:'Sign in',code:'SIGN_IN_REQUIRED'},{status:401});
  if(window.__conflict&&method!=='GET')return Response.json({error:'Changed on another device. Refresh My Bets.',code:'RECORD_CONFLICT'},{status:409});
  const records=window.__db[window.__who]??=[];
  if(method==='GET')return Response.json({records,nextOffset:null});
  if(method==='DELETE'){window.__db[window.__who]=records.filter(r=>r.id!==b.id);return Response.json({deleted:true});}
  const record={...b.record,_version:(b.version||0)+1};window.__db[window.__who]=[record,...records.filter(r=>r.id!==record.id)];return Response.json({record},{status:method==='POST'?201:200});
 }
 if(u.pathname==='/api/form'){const event=makeDemo('all').events.find(e=>e.home_team===u.searchParams.get('team'));const d=makeDemoForm(event);d.mode='live';return Response.json(d);}
 return Response.json({error:'Mock route not found'},{status:404});
};
'''
results=[];errors=[]
def check(name,ok):
 if not ok:raise AssertionError(name)
 results.append(name);print('PASS',name,flush=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 def boot(scenario='demo',width=1440,height=1000,store=None):
  page=browser.new_page(viewport={'width':width,'height':height});page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(HTML);page.evaluate('(a)=>{window.__scenario=a.s;window.__initial=a.store;}',{'s':scenario,'store':store or {'os-adult':'true'}});page.add_script_tag(content='(()=>{'+PRE+SOURCES+'\nwindow.__qa={state,renderAll,tracker,makeDemo,refreshBoard};})();');page.wait_for_timeout(80);return page
 def mybets(page):page.locator('[data-open="tracker"]:visible').first.click();page.wait_for_timeout(50)
 def close(page,id):page.locator(f'[data-close="{id}-dialog"]').first.click()
 def stat(page,label):return page.locator('.tracker-stat').filter(has=page.locator('span',has_text=label)).first.locator('strong').inner_text()
 def save_one(page,index=0):page.locator('#games .like-bet:not([disabled])').nth(index).click();page.wait_for_timeout(40)
 def place(page,stake='25',odds='+150'):
  page.locator('[data-place-bet]').first.click();page.locator('#place-stake').fill(stake);page.locator('#place-odds').fill(odds);page.locator('#place-confirm').check();page.locator('#place-submit').click();page.wait_for_function("!document.getElementById('place-submit').disabled")
 def settle(page,result='won',returned='62.50'):
  page.locator('[data-settle-bet]').first.click();page.locator('#settle-status').select_option(result)
  if not page.locator('#settle-return').is_disabled():page.locator('#settle-return').fill(returned)
  page.locator('#settle-confirm').check();page.locator('#settle-submit').click();page.wait_for_function("!document.getElementById('settle-submit').disabled")
 # Demo: save, pending, win, real isolation, persistence, correction and export.
 page=boot();check('Board renders thumbs-up save controls',page.locator('#games .like-bet').count()>30)
 save_one(page);check('Thumbs-up visibly becomes Saved',page.locator('#games .like-bet.is-liked').count()==1)
 mybets(page);check('Saved idea has no stake or winnings',stat(page,'Net profit')=='$0.00' and page.locator('.tracker-row').count()==1)
 check('Demo is visibly separate from real bets',page.locator('#tracker-mode').input_value()=='demo' and 'Fictional demo' in page.locator('#tracker-storage').inner_text())
 check('Live saved snapshot includes score and exact quote time',page.locator('.tracker-row .tracker-snapshot').text_content().find('Score when saved:')>=0)
 place(page);check('Recording a placement moves it to pending and open stakes',stat(page,'Open stakes')=='$25.00' and page.locator('#tracker-rows').inner_text().find('Result pending')>=0)
 check('An open bet has no realized profit',stat(page,'Net profit')=='$0.00')
 settle(page);check('Win uses returned cash minus stake',stat(page,'Net profit')=='$37.50' and stat(page,'Total returned')=='$62.50')
 check('Winning record retains accepted odds separately', 'accepted +150' in page.locator('#tracker-rows').inner_text())
 page.locator('#tracker-dialog').evaluate('(e)=>e.scrollTop=0');page.screenshot(path=str(OUT/'my-bets-desktop-demo.png'))
 page.locator('#tracker-mode').select_option('real');check('Real totals exclude demo winnings',stat(page,'Net profit')=='$0.00' and page.locator('.tracker-row').count()==0)
 page.locator('#tracker-mode').select_option('demo');page.locator('[data-bet-filter="settled"]').click()
 state=page.evaluate('window.__store');q=boot(store=state);mybets(q);q.locator('[data-bet-filter="settled"]').click();check('Record survives reopening with saved browser data',q.locator('.tracker-row').count()==1 and stat(q,'Net profit')=='$37.50')
 settle(q,'lost');check('Correcting a win to a loss replaces, not duplicates, totals',q.locator('.tracker-row').count()==1 and stat(q,'Net profit')=='-$25.00')
 settle(q,'push');check('Push returns stake without counting a win',stat(q,'Net profit')=='$0.00' and stat(q,'Total returned')=='$25.00')
 settle(q,'cashout','18');check('Cash-out below stake records negative net',stat(q,'Net profit')=='-$7.00')
 q.locator('#tracker-export').click();csv=q.evaluate('window.__csv.text()');check('CSV contains self-reported accounting and separate stake/return', 'self_reported_not_verified' in csv and 'total_returned_including_stake' in csv and '-7' in csv)
 settle(q,'open');check('Reopening removes a settled result and restores open stake',stat(q,'Net profit')=='$0.00' and stat(q,'Open stakes')=='$25.00')
 q.locator('[data-delete-bet]').first.click();check('Delete removes the record and recalculates totals',q.locator('.tracker-row').count()==0 and stat(q,'Open stakes')=='$0.00')
 # Avoid silently claiming a save when localStorage fails.
 s=boot();s.evaluate('window.__storageFail=true');save_one(s);check('Storage failure reports that nothing was saved', 'Nothing was saved' in s.locator('#toast').inner_text());mybets(s);check('Failed local save does not appear as saved',s.locator('.tracker-row').count()==0)
 # Live flow and freshness gates for all three markets.
 live=boot();live.locator('[data-status="live"]').click();check('Live-bets view and caution are visible',live.locator('#board-title').inner_text().startswith('Live bets') and live.locator('#live-board-note').is_visible())
 check('Live filter excludes upcoming cards',live.locator('.game-card').count()==live.locator('.game-card .status-tag.live').count())
 for market in ['spreads','totals']:
  live.locator(f'[data-market="{market}"]').click();live.wait_for_timeout(80);save_one(live);mybets(live)
  check(f'Live {market} can be saved with an exact line',live.locator('.tracker-row').count()>0 and 'In-play snapshot' in live.locator('#tracker-rows').inner_text());close(live,'tracker')
 live.locator('[data-market="h2h"]').click();live.wait_for_timeout(50)
 live.evaluate("()=>{for(const e of window.__qa.state.board.events)for(const b of e.bookmakers)for(const m of b.markets)m.last_update=new Date(Date.now()-100000).toISOString();window.__qa.renderAll();}")
 check('Expired live quotes cannot be newly saved',live.locator('#games .like-bet:not([disabled])').count()==0)
 check('Expired live quotes lose their best-price claim',live.locator('#games .app-pick.best').count()==0)
 # Parlay bridge retains an estimated quote, not a placed bet.
 r=boot();r.locator('[data-open="research"]:visible').first.click();r.locator('#research-analyze').click();r.wait_for_timeout(100);r.locator('[data-use-plan]').first.click();r.locator('#parlay-track').click();r.wait_for_timeout(80)
 check('Research combination saves to My Bets',r.locator('#tracker-dialog').is_visible() and r.locator('.tracker-row').count()==1)
 check('Saved parlay clearly labels the estimate and no wager', 'estimated parlay' in r.locator('#tracker-rows').inner_text() and 'Not a placed bet' in r.locator('#tracker-rows').inner_text())
 # Private account UI: simulated backend, actual UI code.
 a=boot('accounts');mybets(a);a.locator('#tracker-account').click();a.locator('#auth-email').fill('alice@example.test');a.locator('#auth-password').fill('example_test_password');a.locator('#auth-submit').click();a.wait_for_timeout(60)
 check('Account login shows the signed-in owner', 'alice@example.test' in a.locator('#account-current').inner_text());close(a,'account');close(a,'tracker');save_one(a);mybets(a)
 check('Account save is associated with Alice in mock backend',a.evaluate('window.__db.alice.length')==1)
 check('Cloud bet history is not copied into localStorage',a.evaluate("!Object.keys(window.__store).some(k=>k==='os-bets-guest-v4')"))
 a.locator('#tracker-account').click();a.locator('#account-logout').click();a.wait_for_timeout(50);close(a,'account');check('Logout removes cloud records from visible history',a.locator('.tracker-row').count()==0)
 a.locator('#tracker-account').click();a.locator('#auth-email').fill('bob@example.test');a.locator('#auth-password').fill('example_test_password');a.locator('#auth-submit').click();a.wait_for_timeout(50);close(a,'account');check('Bob cannot see Alice history in simulated account flow',a.locator('.tracker-row').count()==0)
 close(a,'tracker');save_one(a,1);mybets(a);check('Bob saves into a separate account history',a.evaluate('window.__db.bob.length')==1 and a.evaluate('window.__db.alice.length')==1)
 a.evaluate('window.__conflict=true');place(a);check('Concurrent edit conflict stays visible; no fake save confirmation', 'another device' in a.locator('#place-error').inner_text() and a.locator('#place-dialog').is_visible());close(a,'place');a.evaluate('window.__conflict=false')
 a.evaluate('window.__offline=true');place(a);check('Offline cloud placement is not silently stored as guest', 'NOT been saved' in a.locator('#place-error').inner_text());close(a,'place');a.evaluate('window.__offline=false')
 # Real guest fallback is explicit when accounts have not been configured.
 g=boot('no-accounts');save_one(g);mybets(g);check('Unconfigured account service supports clearly labeled browser-only guest records','Guest mode' in g.locator('#tracker-storage').inner_text() and g.locator('.tracker-row').count()==1)
 # Layouts and form controls at phone/tablet widths; screenshot uses demo only.
 for width in [390,768]:
  m=boot(width=width,height=844 if width==390 else 1024);m.locator('[data-status="live"]').click();m.screenshot(path=str(OUT/f'live-board-demo-{width}.png'));save_one(m);mybets(m)
  check(f'{width}px My Bets has no horizontal overflow',m.locator('#tracker-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'))
  check(f'{width}px page has no horizontal overflow',m.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  m.locator('#tracker-dialog').evaluate('(e)=>e.scrollTop=0');m.screenshot(path=str(OUT/f'my-bets-demo-{width}.png'));m.locator('[data-place-bet]').first.click()
  check(f'{width}px placement form stays within viewport',m.locator('#place-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'))
  check(f'{width}px placement fields have readable input size',m.locator('#place-stake').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)>=16'))
 check('No JavaScript errors in new tracker flows',not errors)
 browser.close()
(OUT/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'errors':errors,'limitations':'Providers, auth service, RLS enforcement, browser storage and download navigation simulated. No real sportsbook or Supabase project tested.'},indent=2))
print(f'\n{len(results)} tracker browser checks passed. Simulated services and storage.')
