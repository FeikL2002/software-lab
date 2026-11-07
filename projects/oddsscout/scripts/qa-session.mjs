/** Admit an isolated QA context through the actual gate. Never persist or log the code/cookie. */
export async function admitQA(context,base) {
 const origin=new URL(base).origin;
 const status=await context.request.get(new URL('/api/access',origin).href);
 const current=await status.json();
 if(current.authenticated)return;
 const code=process.env.ODDSSCOUT_QA_ACCESS_CODE;
 if(!code)throw new Error('QA needs ODDSSCOUT_QA_ACCESS_CODE in process environment. Never pass it in a URL.');
 const response=await context.request.post(new URL('/api/access',origin).href,{headers:{Origin:origin},data:{code}});
 if(response.status()!==200||!(await response.json()).authenticated)throw new Error('QA admission failed; no credential details were recorded.');
}
