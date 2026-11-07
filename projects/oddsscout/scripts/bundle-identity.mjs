import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function bundleIdentity(){
 const root=fileURLToPath(new URL('../',import.meta.url));
 await mkdir(new URL('../public/vendor/',import.meta.url),{recursive:true});
 await build({
  absWorkingDir:root,
  stdin:{contents:"export {handleAuthCallback,getSettings,getUser,onAuthChange,login,signup,logout,requestPasswordRecovery,updateUser,acceptInvite,oauthLogin,refreshSession} from '@netlify/identity';",resolveDir:root,sourcefile:'identity-browser-entry.mjs'},
  bundle:true,platform:'browser',format:'esm',target:['es2022'],
  outfile:fileURLToPath(new URL('../public/vendor/identity.mjs',import.meta.url)),
  minify:true,legalComments:'inline',logLevel:'warning'
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await bundleIdentity();
