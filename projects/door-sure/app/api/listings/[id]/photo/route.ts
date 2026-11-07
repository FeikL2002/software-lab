import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db";
import { listings } from "../../../../../db/schema";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await context.params;
  const listingId = Number(id);
  const [listing] = await getDb()
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.ownerEmail, user.email)))
    .limit(1);
  if (!listing) return Response.json({ error: "Property not found" }, { status: 404 });

  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) {
    return Response.json({ error: "Choose a property photo." }, { status: 400 });
  }
  if (!allowedTypes.has(photo.type) || photo.size > 8 * 1024 * 1024) {
    return Response.json(
      { error: "Use a JPG, PNG, or WebP image under 8 MB." },
      { status: 400 },
    );
  }

  const key = `properties/${user.email}/${listingId}/${crypto.randomUUID()}`;
  await env.FILES.put(key, photo.stream(), {
    httpMetadata: { contentType: photo.type },
  });
  if (listing.imageKey) await env.FILES.delete(listing.imageKey);

  await getDb()
    .update(listings)
    .set({ imageKey: key, imageContentType: photo.type, status: "pending" })
    .where(eq(listings.id, listingId));

  return Response.json({ imageUrl: `/api/listings/${listingId}/photo` });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const listingId = Number(id);
  const [listing] = await getDb()
    .select()
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing?.imageKey) return new Response("Not found", { status: 404 });

  const user = await getChatGPTUser();
  const canView =
    listing.status === "approved" || user?.email === listing.ownerEmail;
  if (!canView) return new Response("Not found", { status: 404 });

  const object = await env.FILES.get(listing.imageKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": listing.imageContentType ?? "image/jpeg",
      "cache-control":
        listing.status === "approved"
          ? "public, max-age=3600"
          : "private, no-store",
    },
  });
}
