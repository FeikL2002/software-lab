"use client";
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, Copy, ExternalLink, Globe, Menu, MoreVertical, PlusSquare, Share, ShieldCheck, Smartphone } from "lucide-react";
type InstallPrompt = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let availablePrompt:InstallPrompt|null=null;
const LIVE_URL="https://example.invalid";
export function PhoneInstallGuide(){
 const [phone,setPhone]=useState<"iphone"|"android">("iphone");
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null);
 const [copied,setCopied]=useState(false);
 const [installed,setInstalled]=useState(false);
 const [feedback,setFeedback]=useState("");
 const [local,setLocal]=useState(false);
 useEffect(()=>{setPhone(/Android/i.test(navigator.userAgent)?"android":"iphone");setLocal(["localhost","127.0.0.1"].includes(location.hostname));setPrompt(availablePrompt);setInstalled(matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);const listener=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);};const done=()=>{setInstalled(true);setPrompt(null);};window.addEventListener("beforeinstallprompt",listener);window.addEventListener("appinstalled",done);return()=>{window.removeEventListener("beforeinstallprompt",listener);window.removeEventListener("appinstalled",done);};},[]);
 async function copy(){try{await navigator.clipboard.writeText(LIVE_URL);setCopied(true);setFeedback("Link copied. Send this link to his phone, then open it there.");}catch{setFeedback("Select and copy the website link shown below.");}}
 async function install(){if(!prompt)return;await prompt.prompt();const result=await prompt.userChoice;setFeedback(result.outcome==="accepted"?"Installation requested. Look for Clearbill on your Home Screen.":"You can install later from your browser menu.");setPrompt(null);}
 return <><span className="modal-symbol"><Smartphone size={28}/></span><div className="eyebrow">A PLACE ON HIS HOME SCREEN</div><h2 id="dialog-title">Make Clearbill feel like an app.</h2><p>No App Store download needed. Add the website to his phone’s Home Screen in a few steps.</p>
 {installed&&<div className="setup-note"><Check size={19}/><p><strong>Already open as an app.</strong>Clearbill is running in its own window on this device.</p></div>}
 <div className="phone-link-card"><span>STEP 1 · GET THE LINK ON HIS PHONE</span><div><Globe size={16}/><a href={LIVE_URL} target="_blank" rel="noopener noreferrer">example.invalid</a></div><button className="secondary" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?"Copied":"Copy website link"}</button><p>{local?"This computer’s localhost address will not work on his phone. Use the published link above.":"Send this link to his phone, then open it there."}</p></div>
 <div className="modal-tabs phone-tabs"><button className={phone==="iphone"?"active":""} onClick={()=>setPhone("iphone")}><Smartphone size={16}/>iPhone</button><button className={phone==="android"?"active":""} onClick={()=>setPhone("android")}><Smartphone size={16}/>Android</button></div>
 <ol className="install-steps">{(phone==="iphone"?[
 {icon:Globe,title:"Open the link in Safari.",text:"On his iPhone, open Safari and paste the website link. Sign in with an account that has access to this private app."},
 {icon:Share,title:"Tap the Share button.",text:"Look for the square with an arrow pointing up. Depending on the Safari layout, tap the Page Menu button first, then Share."},
 {icon:PlusSquare,title:"Choose “Add to Home Screen”.",text:"Scroll down the Share menu to find it. If asked, keep “Open as Web App” turned on."},
 {icon:Check,title:"Tap “Add”, then open Clearbill.",text:"Keep the name Clearbill and tap Add in the top corner. Find the leaf icon on his Home Screen and tap it to open."}
 ]:[
 {icon:Globe,title:"Open the link in Chrome.",text:"On his Android phone, open Chrome and paste the website link. Sign in with an account that has access to this private app."},
 {icon:MoreVertical,title:"Open the three-dot menu.",text:"Tap the three vertical dots in the top-right corner of Chrome."},
 {icon:ArrowDownToLine,title:"Choose “Install and create shortcut”.",text:"Then tap “Install”. Some versions instead show “Add to home screen” or “Install app”; follow the confirmation on your phone."},
 {icon:Check,title:"Confirm, then open Clearbill.",text:"Tap Install or Add when asked. Find Clearbill’s leaf icon on his Home Screen or in the app drawer."}
 ]).map((item,index)=><li key={item.title}><span className="install-number">{index+2}</span><section><h3><item.icon size={17}/>{item.title}</h3><p>{item.text}</p></section></li>)}</ol>
 {phone==="android"&&prompt&&<button className="primary full" onClick={install}><ArrowDownToLine size={16}/>Install Clearbill on this device</button>}
 {feedback&&<div className="install-feedback" role="status">{feedback}</div>}
 <div className="setup-note"><ShieldCheck size={19}/><p><strong>Home Screen installation and inbox access are separate.</strong>Installing adds an app shortcut. Gmail still needs the app owner’s Google setup and his own authorization. AOL uses private imports. This app is currently private; he needs access before its link will open.</p></div>
 <p className="fine-print">An internet connection is needed to open the app and scan Gmail. Email imports and checklist changes stay in the current session; save a CSV before closing or reloading. To remove the app, press and hold its icon, then choose Remove App or Uninstall.</p>
 <div className="official-install-links"><a href="https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios" target="_blank" rel="noopener noreferrer">Apple’s instructions <ExternalLink size={12}/></a><a href="https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid" target="_blank" rel="noopener noreferrer">Google’s instructions <ExternalLink size={12}/></a></div>
 </>;
}
export function PhoneAppRegistration(){useEffect(()=>{const capture=(event:Event)=>{event.preventDefault();availablePrompt=event as InstallPrompt;};window.addEventListener("beforeinstallprompt",capture);if("serviceWorker" in navigator&&location.protocol==="https:"){navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(()=>{/* The guide remains available if this browser declines a service worker. */});}return()=>window.removeEventListener("beforeinstallprompt",capture);},[]);return null;}
