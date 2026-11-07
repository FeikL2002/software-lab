import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { listings } from "../../../db/schema";

type RuntimeEnv = {
  LISTING_PHOTOS: R2Bucket;
  STRIPE_SECRET_KEY?: string;
};

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const name = clean(form.get("name"));
    const phone = clean(form.get("phone"));
    const address = clean(form.get("address"));
    const price = clean(form.get("price"));
    const condition = clean(form.get("condition"));
    const details = clean(form.get("details"));
    const photos = form.getAll("photos").filter((item): item is File => item instanceof File);

    if (!name || !phone || !address || !price || !condition) {
      return Response.json({ error: "Please complete every required field." }, { status: 400 });
    }
    if (photos.length > MAX_PHOTOS) {
      return Response.json({ error: "A listing can include no more than five photos." }, { status: 400 });
    }
    if (photos.some((photo) => !photo.type.startsWith("image/") || photo.size > MAX_PHOTO_BYTES)) {
      return Response.json({ error: "Photos must be image files no larger than 10 MB each." }, { status: 400 });
    }

    const runtime = env as unknown as RuntimeEnv;
    const id = crypto.randomUUID();
    const photoKeys: string[] = [];

    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const extension = photo.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
      const key = `listings/${id}/${index + 1}.${extension}`;
      await runtime.LISTING_PHOTOS.put(key, photo.stream(), {
        httpMetadata: { contentType: photo.type },
      });
      photoKeys.push(key);
    }

    const db = getDb();
    await db.insert(listings).values({
      id,
      name,
      phone,
      address,
      price,
      condition,
      details,
      photoKeys: JSON.stringify(photoKeys),
      status: "pending_payment",
      createdAt: new Date(),
    });

    if (!runtime.STRIPE_SECRET_KEY) {
      return Response.json(
        { error: "Payments are awaiting Stripe activation.", listingId: id },
        { status: 503 },
      );
    }

    const origin = new URL(request.url).origin;
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "1000",
      "line_items[0][price_data][product_data][name]": "30-day OffMarket property listing",
      "line_items[0][quantity]": "1",
      client_reference_id: id,
      "metadata[listing_id]": id,
      success_url: `${origin}/?payment=success&listing=${id}`,
      cancel_url: `${origin}/?payment=cancelled`,
    });
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const checkout = (await stripeResponse.json()) as { id?: string; url?: string; error?: { message?: string } };

    if (!stripeResponse.ok || !checkout.id || !checkout.url) {
      return Response.json({ error: checkout.error?.message ?? "Checkout could not be started." }, { status: 502 });
    }

    await db.update(listings).set({ stripeSessionId: checkout.id }).where(eq(listings.id, id));
    return Response.json({ checkoutUrl: checkout.url }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Listing could not be submitted." },
      { status: 500 },
    );
  }
}
