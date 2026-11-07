import type {Metadata} from "next";
export const metadata:Metadata={title:"Harbor — Payments & Payment Links",description:"Create payment links, manage earnings, and explore separate test and live payment environments.",referrer:"no-referrer",icons:{icon:"/favicon.svg"},robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><head><link rel="stylesheet" href="/styles.css"/></head><body>{children}</body></html>;}
