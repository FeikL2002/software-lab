import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundleIdentity} from './bundle-identity.mjs';
const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
for(const file of ['.env.local','.env.preview-access','.env'])try {process.loadEnvFile(resolve(root,'../'+file));}catch(e){if(e.code!=='ENOENT')throw e;}
globalThis.Netlify??={env:{get:key=>process.env[key]}};
await bundleIdentity();
const gate=(await import('../netlify/edge-functions/entry-gate.js')).default;
const notFound=(await import('../netlify/functions/api-not-found.mjs')).default;
const routes=new Map();
for(const name of ['access','config','board','sports','calendar','event','performance','community','ask','form','account','my-bets','chat','winnings'])routes.set(`/api/${name}`,(await import(`../netlify/functions/${name}.mjs`)).default);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8'};
async function dispatch(request,ip){
 const url=new URL(request.url),pathName=url.pathname.replace(/^\/\.netlify\/functions\//,'/api/'),handler=routes.get(pathName)||(url.pathname.startsWith('/api/')?notFound:null);
 if(handler)return await handler(request,{ip});
 const path=resolve(root,`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`);
 if(path!==root&&!path.startsWith(root+sep))return new Response('Forbidden',{status:403});
 if(!(await stat(path)).isFile())throw Object.assign(new Error('Not found'),{code:'ENOENT'});
 return new Response(request.method==='HEAD'?null:await readFile(path),{headers:{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff'}});
}
const port=Number(process.env.PORT)||8888;
createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,`http://localhost:${port}`),headers=new Headers();
  for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
  const request=new Request(url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})});
  const ip=req.socket.remoteAddress||'local';
  const response=await gate(request,{next:()=>dispatch(request,ip)})||await dispatch(request,ip);
  const outHeaders=Object.fromEntries(response.headers),cookies=response.headers.getSetCookie();if(cookies.length)outHeaders['set-cookie']=cookies;
  res.writeHead(response.status,outHeaders);res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(e.code==='ENOENT'?'Not found':'Server error');}
}).listen(port,'0.0.0.0',()=>console.log(`OddsScout at http://localhost:${port} (development server with entry gate; not for production)`));
