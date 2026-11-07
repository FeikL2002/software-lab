import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getSessionUser, handleAuthRequest } from "../../../server/auth.mjs";
// The pure backend is shared with Node's database-backed regression tests.
import { handleRequest } from "../../../server/harbor.mjs";

async function route(request: Request) {
  const authPolicy = { allowDevCookie: process.env.NODE_ENV === "development" };
  if (new URL(request.url).pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, { ...authPolicy, getPlatformUser: getChatGPTUser });
  return handleRequest(request, env, { getUser: () => getSessionUser(env.DB, request.headers.get("cookie"), { ...authPolicy, url: request.url }) });
}
export const GET = route;
export const POST = route;
export const PATCH = route;
