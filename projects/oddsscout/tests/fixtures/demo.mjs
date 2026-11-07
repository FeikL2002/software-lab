import { BOOKS, DEFAULT_BOOKS, americanToDecimal } from '../../public/lib/odds.mjs';
export const DEMO_SPORTS = [
 {key:'americanfootball_nfl',title:'NFL',group:'American Football'},
 {key:'basketball_nba',title:'NBA',group:'Basketball'},
 {key:'baseball_mlb',title:'MLB',group:'Baseball'},
 {key:'icehockey_nhl',title:'NHL',group:'Ice Hockey'},
 {key:'soccer_epl',title:'EPL',group:'Soccer'},
 {key:'americanfootball_ncaaf',title:'NCAAF',group:'American Football'},
 {key:'basketball_ncaab',title:'NCAAB',group:'Basketball'},
 {key:'mma_mixed_martial_arts',title:'MMA',group:'Mixed Martial Arts'},
 {key:'tennis_atp_demo',title:'ATP · sample tournament',group:'Tennis'}
];
/** Fictional fixtures and numbers. NEVER represented as actual games or odds. */
export function makeDemo(league = 'upcoming', market = 'h2h', now = Date.now()) {
 const specs = [
  ['demo-nfl-1','americanfootball_nfl','Cleveland Browns','Cincinnati Bengals',17,14,'live',-75,2.5,44.5,[130,140,125,135]],
  ['demo-nba-1','basketball_nba','Cleveland Cavaliers','Boston Celtics',62,59,'live',-55,-3.5,224.5,[-145,-140,-150,-142]],
  ['demo-mlb-1','baseball_mlb','Cleveland Guardians','New York Yankees',3,2,'live',-90,1.5,8.5,[115,120,110,118]],
  ['demo-nhl-1','icehockey_nhl','Columbus Blue Jackets','Pittsburgh Penguins',1,1,'live',-35,1.5,6.5,[155,165,160,150]],
  ['demo-soccer-1','soccer_epl','Arsenal','Chelsea',1,0,'live',-28,-0.5,2.5,[-110,-105,-115,-108]],
  ['demo-nfl-2','americanfootball_nfl','Buffalo Bills','Kansas City Chiefs',null,null,'upcoming',80,-2.5,48.5,[-125,-120,-128,-122]],
  ['demo-nba-2','basketball_nba','New York Knicks','Miami Heat',null,null,'upcoming',120,1.5,218.5,[105,110,102,108]],
  ['demo-mma-1','mma_mixed_martial_arts','Fighter A','Fighter B',null,null,'unknown',-15,null,null,[-110,-105,-115,-108]],
  ['demo-nfl-3','americanfootball_nfl','Baltimore Ravens','Pittsburgh Steelers',null,null,'upcoming',200,-3.5,41.5,[-155,-160,-150,-158]],
  ['demo-nfl-4','americanfootball_nfl','Detroit Lions','Green Bay Packers',null,null,'upcoming',1450,2.5,47.5,[135,128,130,140]],
  ['demo-nfl-5','americanfootball_nfl','Philadelphia Eagles','Dallas Cowboys',null,null,'upcoming',1560,-1.5,45.5,[-120,-125,-118,-122]],
  ['demo-nba-3','basketball_nba','Los Angeles Lakers','Denver Nuggets',null,null,'upcoming',180,4.5,229.5,[160,155,170,165]],
  ['demo-nba-4','basketball_nba','Golden State Warriors','Phoenix Suns',null,null,'upcoming',1510,-1.5,226.5,[-120,-122,-125,-115]],
  ['demo-nba-5','basketball_nba','Milwaukee Bucks','Chicago Bulls',null,null,'upcoming',1640,-6.5,222.5,[-250,-240,-255,-248]],
  ['demo-mlb-2','baseball_mlb','Los Angeles Dodgers','New York Mets',null,null,'upcoming',210,-1.5,7.5,[-170,-180,-175,-165]],
  ['demo-mlb-3','baseball_mlb','San Diego Padres','Philadelphia Phillies',null,null,'upcoming',1430,1.5,8.5,[110,108,115,112]],
  ['demo-nhl-2','icehockey_nhl','Detroit Red Wings','Toronto Maple Leafs',null,null,'upcoming',240,1.5,6.5,[145,140,150,148]],
  ['demo-nhl-3','icehockey_nhl','New York Rangers','Boston Bruins',null,null,'upcoming',1510,-1.5,5.5,[-115,-110,-118,-112]],
  ['demo-soccer-2','soccer_epl','Liverpool','Manchester City',null,null,'upcoming',160,-0.5,3.5,[150,155,160,152]],
  ['demo-soccer-3','soccer_epl','Tottenham Hotspur','Newcastle United',null,null,'upcoming',1500,-0.5,2.5,[-115,-110,-112,-108]],
  ['demo-cfb-1','americanfootball_ncaaf','Ohio State','Michigan',null,null,'upcoming',2900,-7.5,49.5,[-280,-275,-290,-270]],
  ['demo-cfb-2','americanfootball_ncaaf','Texas','Georgia',null,null,'upcoming',3010,3.5,51.5,[140,145,150,148]],
  ['demo-cbb-1','basketball_ncaab','Duke','North Carolina',null,null,'upcoming',3200,-4.5,145.5,[-190,-185,-195,-180]],
  ['demo-cbb-2','basketball_ncaab','Kentucky','Kansas',null,null,'upcoming',3360,2.5,151.5,[125,130,128,135]],
  ['demo-tennis-1','tennis_atp_demo','Player A','Player B',null,null,'upcoming',190,null,null,[-180,-175,-170,-178]],
  ['demo-tennis-2','tennis_atp_demo','Player C','Player D',null,null,'upcoming',340,null,null,[130,130,125,130]],
  ['demo-nhl-no-odds','icehockey_nhl','Seattle Kraken','Vancouver Canucks',null,null,'upcoming',1500,1.5,6.5,[130,125,128,126]]
 ];
 const events = specs.filter(s=>league==='upcoming'||league==='all'||s[1]===league).map(s=>{
  const [id,sport_key,away_team,home_team,a,h,status,minutes,spread,total,prices]=s;
  const start = new Date(now+minutes*60000).toISOString();
  return {id,sport_key,sport_title:DEMO_SPORTS.find(x=>x.key===sport_key)?.title||sport_key,away_team,home_team,commence_time:start,status,statusCheckedAt:new Date(now).toISOString(),scoreUpdatedAt:status==='live'?new Date(now-12000).toISOString():null,scores: a==null?null:[{name:away_team,score:String(a)},{name:home_team,score:String(h)}],
   bookmakers:(id==='demo-nhl-no-odds'?[]:['draftkings','fanduel','betmgm','betrivers']).map((key,i)=>{
    const updated=new Date(now-[17000,9000,26000,21000][i]).toISOString();
    const markets=[{key:'h2h',last_update:updated,outcomes:[{name:away_team,price:americanToDecimal(prices[i])},{name:home_team,price:americanToDecimal(prices[i]>0?-prices[i]-25:Math.max(100,Math.abs(prices[i])-20))},...(sport_key==='soccer_epl'?[{name:'Draw',price:[3.3,3.4,3.25,3.35][i]}]:[])]}];
    if(spread!=null) {const line=spread+(i===3?0.5:0);markets.push({key:'spreads',last_update:updated,outcomes:[{name:away_team,point:line,price:americanToDecimal([-110,-105,-112,-108][i])},{name:home_team,point:-line,price:americanToDecimal([-110,-115,-108,-112][i])}]});}
    if(total!=null) {const line=total+(i===3?1:0);markets.push({key:'totals',last_update:updated,outcomes:[{name:'Over',point:line,price:americanToDecimal([-110,-105,-112,-108][i])},{name:'Under',point:line,price:americanToDecimal([-110,-115,-108,-112][i])}]});}
    return {key,title:BOOKS[key].name,last_update:updated,markets:markets.filter(m=>m.key===market)};
   })};
 });
 return {mode:'demo',source:'Fictional sample data',league,market,events,fetchedAt:new Date(now).toISOString(),configuredBooks:DEFAULT_BOOKS,usage:null,warnings:[],refreshSeconds:60,coverage:(league==='upcoming'||league==='all')?'Sample live and upcoming fixtures. These are not real games.':'Fictional league fixtures. These are not real games.'};
}

/** Fabricated history used ONLY after explicit demo entry. Never returned by the server. */
export function makeDemoForm(event,now=Date.now()){
 const games=[];
 for(const team of [event.away_team,event.home_team]){
  const seed=[...team].reduce((s,c)=>s+c.charCodeAt(0),0),interval=event.sport_key.includes('football')?7:2;
  for(let i=0;i<10;i++){
   const win=((seed+i*3)%10)<(seed%3+5),home=i%2===0,opponent=`Sample opponent ${i+1}`;
   const base=event.sport_key.includes('basketball')?100:event.sport_key.includes('football')?20:2;
   const scored=base+(win?4:0)+(i%3),allowed=base+(win?0:3)+(i%3);
   games.push({id:`fictional:${event.sport_key}:${team}:${i}`,league:event.sport_key,date:new Date(now-(i+1)*interval*86400000).toISOString(),completed:true,homeTeam:home?team:opponent,awayTeam:home?opponent:team,homeScore:home?scored:allowed,awayScore:home?allowed:scored,source:'Fictional sample history'});
  }
 }
 return {mode:'demo',source:'Fictional sample history',league:event.sport_key,teams:[event.away_team,event.home_team],games,complete:true,fetchedAt:new Date(now).toISOString(),limitations:['All scores, dates and form records in this preview are fabricated.']};
}
