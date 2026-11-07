"""Offline DOM/browser tests for v2. Providers AND browser storage are simulated.
No external navigation, real provider connection, or physical Safari claim.
Run: python tests/browser_test.py (requires Playwright + Chromium).
"""
from pathlib import Path
import base64,json,re,os,shutil
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('BROWSER_TEST_OUTPUT',str(ROOT/'test-output')));OUT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'public/index.html').read_text()
HTML=re.sub(r'<script\b[^>]*>.*?</script>','',HTML,flags=re.S)
HTML=re.sub(r'<link\b[^>]*>','',HTML)
ICON='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'public/icon.svg').read_bytes()).decode()
HTML=HTML.replace('src="/icon.svg"',f'src="{ICON}"').replace('</head>','<style>'+(ROOT/'public/styles.css').read_text()+'</style></head>')
SOURCES='\n'.join(re.sub(r'^import .*;\n','',(ROOT/'public'/file).read_text(),flags=re.M) for file in ['lib/odds.mjs','lib/board.mjs','lib/demo.mjs','lib/parlays.mjs','lib/bets.mjs','tracker-ui.mjs','research-ui.mjs','app.mjs'])
SOURCES=re.sub(r'\bexport\s+(?=const|function)','',SOURCES)
SOURCES=SOURCES.replace("if(new URLSearchParams(location.search).get('demo')==='1')enterDemo();else bootstrap();","if(window.__scenario==='demo')enterDemo();else bootstrap();")
PRE=r'''
const storageData=window.__initialStorage||{};
const storage={getItem:k=>storageData[k]??null,setItem:(k,v)=>storageData[k]=String(v),removeItem:k=>delete storageData[k]};
Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
Object.defineProperty(window,'sessionStorage',{value:storage,configurable:true});
Object.defineProperty(navigator,'onLine',{get:()=>!window.__offline,configurable:true});
window.__storage=storageData;window.__requests=[];
window.fetch=async(path,options={})=>{
 const u=new URL(path,'https://fixture.invalid');window.__requests.push({path:u.pathname,query:u.search,body:options.body||null});
 if(window.__offline)throw new TypeError('Simulated offline');
 if(u.pathname==='/api/config'){
  if(window.__scenario==='404')return new Response('Not found',{status:404});
  if(window.__scenario==='html')return new Response('<html>SPA</html>',{headers:{'content-type':'text/html'}});
  return Response.json({apiVersion:2,allLeaguesAvailable:true,oddsConfigured:window.__scenario!=='missing',aiEnabled:window.__scenario==='ai',roomLocked:window.__scenario==='locked',configuredBooks:DEFAULT_BOOKS});
 }
 if(window.__scenario==='locked'&&options.headers['X-Room-Code']!=='test-room')return Response.json({error:'Shared room code required',code:'ROOM_LOCKED'},{status:401});
 if(u.pathname==='/api/sports')return Response.json({sports:DEMO_SPORTS});
 if(u.pathname==='/api/board'){
  if(window.__fail===429)return Response.json({error:'Provider cooldown',code:'PROVIDER_LIMIT'},{status:429,headers:{'retry-after':'90'}});
  if(window.__fail)return Response.json({error:'Simulated provider outage',code:'PROVIDER_UNAVAILABLE'},{status:502});
  const league=u.searchParams.get('league'),market=u.searchParams.get('market')||'h2h';
  const result=makeDemo(league,market);result.mode='live';result.source='Simulated test provider';
  if(league==='all'){
   const all=[...DEMO_SPORTS].sort((a,b)=>a.key.localeCompare(b.key)),page=Number(u.searchParams.get('page')||0),leagues=all.slice(page*3,page*3+3);
   const failed=window.__scenario==='partial'&&page===1?[{...leagues.pop(),error:'Simulated league outage',code:'PROVIDER_UNAVAILABLE'}]:[];
   result.events=result.events.filter(e=>leagues.some(s=>s.key===e.sport_key));
   result.batch={page,totalPages:Math.ceil(all.length/3),nextPage:page+1<Math.ceil(all.length/3)?page+1:null,totalLeagues:all.length,loaded:leagues,failed,halted:null};
   if(window.__scenario==='quota'){result.batch.halted={code:'PROVIDER_LIMIT',retryAfter:90};result.batch.nextPage=null;}
  }
  if(window.__scenario==='empty')result.events=[];
  if(window.__scenario==='stale')for(const event of result.events)for(const book of event.bookmakers)for(const market of book.markets)market.last_update=new Date(Date.now()-400000).toISOString();
  result.coverage='SIMULATED provider coverage for offline browser tests.';
  return Response.json(result);
 }
 if(u.pathname==='/api/form'){
  if(window.__scenario==='form-missing')return Response.json({error:'Recent form is not configured.',code:'FORM_NOT_CONFIGURED'},{status:503});
  if(window.__scenario==='form-rate')return Response.json({error:'Recent-results provider is on cooldown.',code:'FORM_LIMIT'},{status:429,headers:{'retry-after':'60'}});
  const event=makeDemo('all','h2h').events.find(e=>e.home_team===u.searchParams.get('team')&&e.away_team===u.searchParams.get('opponent'));
  if(!event)return Response.json({error:'Test fixture missing'},{status:422});
  const form=makeDemoForm(event);form.mode='live';form.source='SIMULATED recent-results provider';
  if(window.__scenario==='form-incomplete')form.complete=false;
  return Response.json(form);
 }
 if(u.pathname==='/api/ask')return Response.json({mode:window.__scenario==='ai'?'ai':'rules',text:'SIMULATED explanation: compare the same bet. No guaranteed winner.',note:'Test-only upstream response.'});
 return Response.json({error:'Unknown test endpoint'},{status:404});
};
'''
results=[]
def check(name,condition):
 if not condition:raise AssertionError(name)
 results.append(name);print('PASS',name)
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 all_errors=[]
 def boot(scenario='live',width=1440,height=1040,storage=None,adult=True):
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
  page.on('pageerror',lambda e:all_errors.append(str(e)))
  page.set_content(HTML)
  page.evaluate('([s,v])=>{window.__scenario=s;window.__initialStorage=v}',[scenario,storage if storage is not None else ({'os-adult':'true'} if adult else {})])
  page.add_script_tag(content=PRE+'\n'+SOURCES+'\nwindow.__test={refreshBoard,bootstrap,state,enterDemo};')
  page.wait_for_timeout(160)
  return page
 page=boot('demo')
 check('All 27 sample games appear by default',page.locator('.game-card').count()==27)
 check('Games are grouped into all nine leagues',page.locator('.league-section').count()==9)
 check('Default status is All games',page.locator('[data-status="all"]').get_attribute('aria-pressed')=='true')
 check('Each visible best-app tile names a specific selection',page.locator('.pick-selection').count()>45)
 check('No-odds game stays listed',page.locator('[data-event="demo-nhl-no-odds"] .no-market').count()==1)
 check('Soccer retains all three selections',page.locator('[data-event="demo-soccer-1"] .app-pick').count()==3)
 check('Tied quote names every tied app',all(x in page.locator('[data-event="demo-tennis-2"] .app-pick').first.inner_text() for x in ['DraftKings','FanDuel','BetRivers']))
 check('App links are external websites, not submitted bets',page.locator('.open-apps a').first.get_attribute('rel')=='noopener noreferrer')
 check('Desktop has no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 page.screenshot(path=str(OUT/'desktop.png'))
 page.locator('[data-status="live"]').click();check('Live filter returns five confirmed samples',page.locator('.game-card').count()==5)
 page.locator('[data-status="upcoming"]').click();check('Upcoming filter returns 21 samples',page.locator('.game-card').count()==21)
 page.locator('[data-status="unknown"]').click();check('Unknown status remains distinct from live',page.locator('.game-card').count()==1)
 page.locator('[data-status="all"]').click()
 page.locator('[data-sport="American Football"]').click();check('Sport filter includes NFL and college football',page.locator('.game-card').count()==7)
 page.locator('[data-sport="all"]').click()
 page.locator('[data-open="filters"]').click();page.locator('#search').fill('Browns');page.locator('#filters-show').click()
 check('Team search narrows to the right game',page.locator('.game-card').count()==1 and page.locator('.game-card').get_attribute('data-event')=='demo-nfl-1')
 check('Best app differs by side, not one misleading game-wide winner',page.locator('.app-pick .pick-book strong').all_inner_texts()==['FanDuel','BetMGM'])
 page.locator('[data-open="filters"]').click();page.locator('#board-stake').fill('50');page.locator('#board-stake').dispatch_event('change');page.locator('#odds-format').select_option('decimal');page.locator('#filters-show').click()
 check('Decimal format renders correctly',page.locator('.app-pick .price').first.inner_text()=='2.40')
 check('Changing the example stake updates card profit', '$70.00 profit' in page.locator('.app-pick').first.inner_text())
 page.locator('.pick-main').first.click();check('Clicking the best app opens the comparison dialog',page.locator('#compare-dialog').evaluate('(d)=>d.open'))
 check('Detailed payout agrees with the card',page.locator('#profit').inner_text()=='$70.00' and page.locator('#total-return').inner_text()=='$120.00')
 page.locator('#stake').fill('30');page.locator('#stake').dispatch_event('change')
 check('Detail calculator accepts edits without losing input focus value',page.locator('#profit').inner_text()=='$42.00')
 page.locator('[data-question]').first.click();expect(page.locator('#answer-note')).to_contain_text('RULES-BASED')
 check('Demo explanation is explicitly not AI','Rules-based' in page.locator('#assistant-mode').inner_text())
 page.locator('[data-close="compare-dialog"]').click()
 page.locator('[data-save="demo-nfl-1"]').click();saved=page.evaluate('window.__storage')
 restored=boot('demo',storage=saved);check('Watchlist restores from persisted storage values',restored.locator('[data-save="demo-nfl-1"]').get_attribute('aria-pressed')=='true');restored.close()
 page.locator('[data-nav="favorites"]').first.click();check('Watchlist view shows the saved game',page.locator('.game-card').count()==1)
 page.locator('[data-nav="board"]').first.click()
 page.locator('[data-market="spreads"]').click();page.locator('.pick-main').first.click()
 check('Alternative spread lines remain individually selectable',len(page.locator('#selection option').all_text_contents())==4)
 page.locator('[data-close="compare-dialog"]').click();page.locator('[data-market="totals"]').click()
 check('Totals display Over and Under separately',all(x in ' '.join(page.locator('.pick-selection').all_inner_texts()) for x in ['Over 44.5','Under 44.5']))
 page.locator('[data-open="settings"]').first.click()
 for k in ['draftkings','betmgm','betrivers']:page.locator(f'[data-book][value="{k}"]').uncheck()
 page.locator('[data-close="settings-dialog"]').last.click()
 check('One remaining app is not called a comparative best',page.locator('.app-pick').first.get_attribute('data-verdict')=='single')
 page.close()
 # Date and league selectors are independent of status/sport filtering.
 page=boot('demo');page.locator('[data-open="filters"]').click();page.locator('#date-range').select_option('tomorrow');page.locator('#filters-show').click()
 check('Tomorrow filter narrows the full board',0<page.locator('.game-card').count()<27)
 page.locator('[data-open="filters"]').click();page.locator('#date-range').select_option('all');page.locator('#league').select_option('basketball_ncaab');page.locator('#filters-show').click()
 check('League filter includes games more than 48 hours away',page.locator('.game-card').count()==2)
 page.close()
 for width in [320,390,768,1024]:
  page=boot('demo',width,844)
  check(f'{width}px layout does not overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  if width==390:
   page.screenshot(path=str(OUT/'mobile.png'));page.evaluate('window.scrollTo(0,380)');page.screenshot(path=str(OUT/'mobile-board.png'));page.evaluate('window.scrollTo(0,0)')
   page.locator('.pick-main').first.click();check('Mobile game button opens a usable comparison',page.locator('#compare-dialog').evaluate('(d)=>d.open'))
   check('Mobile comparison fits viewport',page.locator('#compare-dialog').evaluate('(d)=>d.getBoundingClientRect().right<=innerWidth'))
   page.screenshot(path=str(OUT/'mobile-comparison.png'))
  page.close()
 page=boot();check('Provider-mode browser follows all three league batches',len([r for r in page.evaluate('window.__requests') if r['path']=='/api/board'])==3)
 check('All-league scan completes at nine of nine leagues','9 / 9 leagues loaded · scan complete' in page.locator('#coverage-summary').inner_text())
 page.locator('.pick-main').first.click();page.locator('[data-question]').first.click();page.wait_for_timeout(80)
 body=json.loads([r for r in page.evaluate('window.__requests') if r['path']=='/api/ask'][0]['body'])
 check('Explainer requests the selected game league, not a limited cross-sport feed',body['league']=='baseball_mlb')
 page.locator('[data-close="compare-dialog"]').click();page.evaluate('window.__offline=true;window.dispatchEvent(new Event("offline"))')
 check('Offline snapshot never continues advertising best apps',page.locator('.app-pick.best').count()==0)
 page.close()
 for scenario,needle in [('partial','partial coverage'),('quota','partial coverage')]:
  page=boot(scenario);check(f'{scenario} scan is visibly incomplete',needle in page.locator('#coverage-summary').inner_text())
  if scenario=='quota':check('Quota halt stops after one batch',len([r for r in page.evaluate('window.__requests') if r['path']=='/api/board'])==1)
  page.close()
 for scenario in ['404','html','missing']:
  page=boot(scenario);check(f'{scenario} configuration never silently loads fictional games',page.locator('.game-card').count()==0)
  page.close()
 page=boot('stale');check('Old provider quotes are not ranked',page.locator('.app-pick.best,.app-pick.tie').count()==0 and page.locator('.app-pick.unavailable').count()>0);page.close()
 page=boot('empty');check('Empty feed gets a meaningful empty state',page.locator('.empty-state').count()==1);page.close()
 page=boot('ai');page.locator('.pick-main').first.click();page.locator('[data-question]').first.click();page.wait_for_timeout(50)
 check('Simulated AI path is distinct from rules mode','AI EXPLANATION' in page.locator('#answer-note').inner_text());page.close()
 page=boot('locked');check('Shared-code gate appears before data',page.locator('#room-dialog').evaluate('(d)=>d.open'))
 page.locator('#room-code').fill('test-room');page.locator('#room-form button').click();expect(page.locator('.game-card')).to_have_count(27,timeout=5000)
 check('Valid room code unlocks all-league loading',page.locator('.game-card').count()==27);page.close()
 page=boot('demo',adult=False);check('Age notice remains before initial use',page.locator('#age-dialog').evaluate('(d)=>d.open'));page.close()
 for scenario in ['form-missing','form-rate','form-incomplete']:
  page=boot(scenario);page.locator('.research-banner [data-open="research"]').click();page.locator('#research-analyze').click();page.wait_for_timeout(180)
  check(f'{scenario}: no invented research combination',page.locator('.research-option').count()==0)
  if scenario=='form-missing':check('Missing stats configuration is visible','not configured' in page.locator('#research-status').inner_text())
  if scenario=='form-rate':check('Stats cooldown stops further form requests',len([r for r in page.evaluate('window.__requests') if r['path']=='/api/form'])==1)
  page.close()
 page=boot('form-live');page.locator('.research-banner [data-open="research"]').click();page.locator('#research-analyze').click();page.wait_for_timeout(200)
 check('Mocked provider-mode history produces research options',page.locator('.research-option').count()==3)
 page.locator('[data-use-plan="0"]').click();check('Mocked provider-mode ticket compares four apps',page.locator('.parlay-book').count()==4)
 page.evaluate('window.__offline=true;window.dispatchEvent(new Event("offline"))')
 check('Offline state removes current parlay rankings',page.locator('.parlay-book').count()==0 and page.locator('.research-option').count()==0)
 check('Offline state disables paper saving of a new price',page.locator('#parlay-save').is_disabled())
 page.close()
 check('No JavaScript errors in tested flows',all_errors==[])
 browser.close()
(OUT/'browser-results.json').write_text(json.dumps({'passed':len(results),'checks':results,'javascript_errors':all_errors,'method':'Offline Chromium DOM tests; upstream responses and storage simulated.'},indent=2))
print(f'\n{len(results)} browser checks passed. Provider responses and storage are simulated.')
