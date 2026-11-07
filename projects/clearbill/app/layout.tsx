import { PhoneAppRegistration } from "@/components/phone-install-guide";
import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Clearbill — Your subscriptions, in sight.",description:"Find subscription clues in your emails, understand recurring costs, and follow official cancellation guides. Private Gmail and AOL email imports.",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,title:"Clearbill",statusBarStyle:"default"},icons:{icon:[{url:"/favicon.svg",type:"image/svg+xml"},{url:"/icons/icon-192.png",sizes:"192x192",type:"image/png"}],shortcut:"/favicon.svg",apple:"/icons/apple-touch-icon.png"},robots:{index:false,follow:false}};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#245a40"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body><PhoneAppRegistration/>{children}</body></html>}
