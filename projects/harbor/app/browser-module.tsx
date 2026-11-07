"use client";
import {useEffect} from "react";

export default function BrowserModule({src}:{src:string}) {
  useEffect(() => {
    const script=window.document.createElement("script");
    script.type="module";
    script.src=src;
    window.document.body.appendChild(script);
    return () => { script.remove(); };
  },[src]);
  return null;
}
