import { dashboardShell } from "./shell";
import BrowserModule from "./browser-module";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { requireHarborUser } from "./harbor-auth";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const user = await requireHarborUser();
  if (!env.DB) throw new Error("Harbor's account database is unavailable.");
  const merchant = await env.DB.prepare("SELECT onboarding_completed_at FROM merchants WHERE owner_user_id=?").bind(user.userId).first<{ onboarding_completed_at: string | null }>();
  if (!merchant?.onboarding_completed_at) redirect("/signup");
  return <><div dangerouslySetInnerHTML={{__html:dashboardShell}}/><BrowserModule src="/app.js"/></>;
}
