import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { inquiries, listings } from "../../../db/schema";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const rows = await getDb()
    .select({
      id: inquiries.id,
      listingId: inquiries.listingId,
      renterEmail: inquiries.renterEmail,
      message: inquiries.message,
      status: inquiries.status,
      createdAt: inquiries.createdAt,
      address: listings.address,
      city: listings.city,
    })
    .from(inquiries)
    .innerJoin(listings, eq(inquiries.listingId, listings.id))
    .where(eq(inquiries.landlordEmail, user.email))
    .orderBy(desc(inquiries.createdAt))
    .limit(100);

  return Response.json({ inquiries: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json()) as {
    listingId?: number;
    message?: string;
  };
  const listingId = Number(body.listingId);
  const message = body.message?.trim() ?? "";
  if (!Number.isInteger(listingId) || message.length < 10 || message.length > 1200) {
    return Response.json(
      { error: "Write a message between 10 and 1,200 characters." },
      { status: 400 },
    );
  }

  const [listing] = await getDb()
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.status, "approved")))
    .limit(1);
  if (!listing) return Response.json({ error: "Listing not found" }, { status: 404 });
  if (listing.ownerEmail === user.email) {
    return Response.json({ error: "You own this listing." }, { status: 400 });
  }

  const [inquiry] = await getDb()
    .insert(inquiries)
    .values({
      listingId,
      renterEmail: user.email,
      landlordEmail: listing.ownerEmail,
      message,
    })
    .returning();
  return Response.json({ inquiry }, { status: 201 });
}
