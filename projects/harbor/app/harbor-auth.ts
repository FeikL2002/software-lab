import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../server/auth.mjs";

export type HarborUser = { userId: string; email: string; displayName: string; authProvider: "email"; emailVerified: boolean };

export async function getHarborUser(): Promise<HarborUser | null> {
  const requestHeaders = await headers();
  // Only the development framework permits plain-HTTP loopback cookies.
  // Production ignores forwarded host/protocol metadata and accepts only the
  // secure __Host cookie, even if a caller supplies a localhost Host header.
  const host = requestHeaders.get("host") || "";
  const local = process.env.NODE_ENV === "development" && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  const user = await getSessionUser(env.DB, requestHeaders.get("cookie"), local ? { url: `http://${host}`, allowDevCookie: true } : {});
  return user ? { ...user, authProvider: "email" } : null;
}

export async function requireHarborUser(): Promise<HarborUser> {
  const user = await getHarborUser();
  if (!user) redirect("/login");
  return user;
}
