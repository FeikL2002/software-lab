import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const SUPPORT_EMAIL = "owner@example.com";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json() as { message?: string; page?: string };
  const message = body.message?.trim();
  const page = body.page?.trim() || "unknown";
  if (!message || message.length > 2000) {
    return Response.json({ error: "Enter a message under 2,000 characters" }, { status: 400 });
  }

  await env.DB.prepare(
    "INSERT INTO app_problems (user_email, message, page, created_at) VALUES (?, ?, ?, ?)",
  ).bind(user.email, message, page, new Date().toISOString()).run();

  const subject = encodeURIComponent("goodfind app problem");
  const emailBody = encodeURIComponent(
    `A goodfind user reported a problem.\n\nFrom: ${user.email}\nPage: ${page}\n\n${message}`,
  );
  return Response.json({
    saved: true,
    mailtoUrl: `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${emailBody}`,
  });
}
