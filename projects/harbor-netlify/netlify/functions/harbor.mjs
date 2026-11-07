import { getDatabase } from "@netlify/database";
import { createDatabase } from "../../server/postgres.mjs";
import { handlePrivateRequest } from "../../server/private-http.mjs";

let db;
export default async (request, context) => {
  const env = {};
  for (const name of ["HARBOR_ALLOWED_EMAILS", "HARBOR_INVITE_CODE_HASH", "HARBOR_OWNER_EMAIL", "HARBOR_OWNER_MERCHANT_ID"]) env[name] = Netlify.env.get(name);
  try {
    db ||= createDatabase(getDatabase().pool);
    env.DB = db;
    return await handlePrivateRequest(request, env, { clientIp: context.ip || "unavailable" });
  } catch {
    // Do not expose connection strings, credentials, or database errors.
    return Response.json({ code: "service_unavailable", error: "Harbor is temporarily unavailable. Please try again." }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
  }
};

export const config = { path: ["/", "/login", "/signup", "/logout", "/pay/*", "/api/*"] };
