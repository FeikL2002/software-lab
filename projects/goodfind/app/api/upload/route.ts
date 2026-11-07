import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("photo");
  const listingId = Number(form.get("listingId"));
  if (!(file instanceof File) || !Number.isInteger(listingId)) {
    return Response.json({ error: "One photo and a listing are required" }, { status: 400 });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return Response.json({ error: "Use a JPG, PNG, or WebP photo" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "Photo must be 5 MB or smaller" }, { status: 400 });
  }

  const listing = await env.DB.prepare(
    "SELECT id, photo_key AS photoKey FROM listings WHERE id = ? AND owner_email = ?",
  ).bind(listingId, user.email).first<{ id: number; photoKey: string | null }>();
  if (!listing) return Response.json({ error: "Listing not found" }, { status: 404 });

  const media = (env as unknown as { MEDIA: R2Bucket }).MEDIA;
  if (listing.photoKey) await media.delete(listing.photoKey);
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `listings/${listingId}/${crypto.randomUUID()}.${extension}`;
  await media.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { ownerEmail: user.email, listingId: String(listingId) },
  });
  await env.DB.prepare("UPDATE listings SET photo_key = ? WHERE id = ?").bind(key, listingId).run();

  return Response.json({ photoUrl: `/api/images/${encodeURIComponent(key)}` });
}
