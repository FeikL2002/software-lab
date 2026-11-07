"""Test the generated single HTML, with storage substituted for this test browser's opaque origin.
No provider or auth service is connected. Native file navigation/storage are not tested.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re,shutil,os
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'OddsScout-My-Bets-Live-Interactive.html').read_text()
scripts='\n'.join(re.findall(r'<script\b[^>]*>(.*?)</script>',html,flags=re.S))
html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
checks=[]
def check(name,result):
 assert result,name
 checks.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html)
 page.add_script_tag(content="window.__store={};window.__requests=[];const testStore={getItem:k=>window.__store[k]??null,setItem:(k,v)=>window.__store[k]=v,removeItem:k=>delete window.__store[k]};Object.defineProperty(window,'localStorage',{value:testStore});Object.defineProperty(window,'sessionStorage',{value:testStore});window.fetch=(url)=>{window.__requests.push(url);throw new Error('No network permitted in demo');};")
 page.add_script_tag(content=scripts);page.locator('#confirm-age').click();page.wait_for_timeout(80)
 check('Standalone renders 27 explicitly fictional games without requesting an API',page.locator('.game-card').count()==27 and page.evaluate('window.__requests.length')==0 and 'FICTIONAL DEMO' in page.title())
 page.locator('#games .like-bet:not([disabled])').first.click();page.locator('.top-my-bets').click();page.wait_for_timeout(70)
 check('Thumbs-up in bundled file opens a saved demo record',page.locator('.tracker-row').count()==1 and page.locator('#tracker-mode').input_value()=='demo')
 page.locator('[data-place-bet]').first.click();page.locator('#place-stake').fill('25');page.locator('#place-odds').fill('+150');page.locator('#place-confirm').check();page.locator('#place-submit').click();page.wait_for_function("!document.getElementById('place-submit').disabled")
 check('Standalone tracks a pending stake separately', 'Demo Open stakes\n$25.00' in page.locator('#tracker-stats').inner_text() and 'Demo Net profit\n$0.00' in page.locator('#tracker-stats').inner_text())
 page.locator('[data-settle-bet]').first.click();page.locator('#settle-return').fill('62.50');page.locator('#settle-confirm').check();page.locator('#settle-submit').click();page.wait_for_function("!document.getElementById('settle-submit').disabled")
 check('Standalone result math distinguishes cash returned from net profit', 'Demo Net profit\n$37.50' in page.locator('#tracker-stats').inner_text() and 'Demo Total returned\n$62.50' in page.locator('#tracker-stats').inner_text())
 page.locator('#tracker-account').click();check('Offline file clearly disables real account sign-in',page.locator('#auth-submit').is_disabled() and 'no account server' in page.locator('#account-current').inner_text())
 check('Standalone uses no network calls and raises no script errors',not errors and page.evaluate('window.__requests.length')==0)
 b.close()
print(f'{len(checks)} standalone browser checks passed. Browser storage simulated; no real services connected.')
