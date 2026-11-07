import {cp,mkdir,rm,readFile,stat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundleIdentity} from './bundle-identity.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
await bundleIdentity();
const names=['access','config','sports','board','calendar','event','performance','community','ask','form','account','my-bets','chat','winnings','api-not-found'];
const toml=await readFile('netlify.toml','utf8');
for(const name of names){
 const file=`netlify/functions/${name}.mjs`;
 if(!(await stat(file)).isFile())throw new Error(`Missing required function: ${name}`);
 execFileSync(process.execPath,['--check',file]);
 if(!toml.includes(`to = "/.netlify/functions/${name}"`))throw new Error(`Missing Netlify rewrite for ${name}`);
}
if(!toml.includes('functions = "netlify/functions"')||!toml.includes('publish = "dist"'))throw new Error('Unexpected publish/functions directory.');
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 const file=join(dir,e.name);
 if(e.name.startsWith('.env')||['server','netlify','node_modules'].includes(e.name))throw new Error(`Server-only file inside public/: ${relative(root,file)}`);
 if(e.isDirectory())await scan(file);
 else if(/\.(mjs|js)$/.test(file))execFileSync(process.execPath,['--check',file]);
}}
await scan(resolve('public'));
const edge=await readFile('netlify/edge-functions/entry-gate.js','utf8');
if(!edge.includes("path:'/*'")||!edge.includes("onError:'fail'"))throw new Error('Missing fail-closed entry Edge routing.');
execFileSync(process.execPath,['--check','netlify/edge-functions/entry-gate.js']);
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await rm('dist/lib/demo.mjs',{force:true});
console.log(`Build passed: static app -> dist/, ${names.length} server function files + 1 entry Edge Function and API rewrites validated.`);
console.log('Netlify must bundle/deploy the functions separately. Use the project root, not a dist-only upload.');
