import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

type CreateListingBody = {
  title?: string;
  location?: string;
  startDate?: string;
  description?: string;
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const result = await env.DB.prepare(
    `SELECT id, title, location, start_date AS startDate, description, photo_key AS photoKey, status,
      price_paid_cents AS pricePaidCents, views, saves, created_at AS createdAt
     FROM listings WHERE owner_email = ? ORDER BY id DESC`,
  ).bind(user.email).all();

  return Response.json({
    listings: result.results.map((listing) => ({
      ...listing,
      photoUrl: listing.photoKey ? `/api/images/${encodeURIComponent(String(listing.photoKey))}` : null,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  let body: CreateListingBody;
  try {
    body = await request.json() as CreateListingBody;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const title = body.title?.trim();
  const location = body.location?.trim();
  const startDate = body.startDate?.trim();
  const description = body.description?.trim() ?? "";
  if (!title || !location || !startDate) {
    return Response.json({ error: "Title, location, and date are required" }, { status: 400 });
  }

  const result = await env.DB.prepare(
    `INSERT INTO listings
      (owner_email, title, location, start_date, description, status, price_paid_cents, views, saves, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', 2000, 0, 0, ?)`,
  ).bind(user.email, title, location, startDate, description, new Date().toISOString()).run();

  return Response.json({
    listing: {
      id: result.meta.last_row_id,
      title,
      location,
      startDate,
      description,
      status: "active",
      pricePaidCents: 2000,
      views: 0,
      saves: 0,
    },
  }, { status: 201 });
}
