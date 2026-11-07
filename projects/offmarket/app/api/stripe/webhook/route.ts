import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { listings } from "../../../../db/schema";

type RuntimeEnv = { STRIPE_WEBHOOK_SECRET?: string };

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validSignature(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  if (!parts.t || !parts.v1) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${payload}`)),
  );
  return signature === parts.v1;
}

export async function POST(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  const secret = runtime.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature") ?? "";
  const payload = await request.text();

  if (!secret || !(await validSignature(payload, signature, secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: { client_reference_id?: string; metadata?: { listing_id?: string } } };
  };
  if (event.type === "checkout.session.completed") {
    const id =
      event.data?.object?.metadata?.listing_id ??
      event.data?.object?.client_reference_id;
    if (id) {
      await getDb().update(listings).set({ status: "paid" }).where(eq(listings.id, id));
    }
  }

  return Response.json({ received: true });
}
