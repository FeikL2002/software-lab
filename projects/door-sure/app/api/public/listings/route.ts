import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { listings } from "../../../../db/schema";

export async function GET() {
  const rows = await getDb()
    .select({
      id: listings.id,
      address: listings.address,
      city: listings.city,
      state: listings.state,
      zip: listings.zip,
      propertyType: listings.propertyType,
      beds: listings.beds,
      baths: listings.baths,
      monthlyRent: listings.monthlyRent,
      imageKey: listings.imageKey,
      createdAt: listings.createdAt,
    })
    .from(listings)
    .where(eq(listings.status, "approved"))
    .orderBy(desc(listings.createdAt))
    .limit(100);

  return Response.json({
    listings: rows.map((row) => ({
      ...row,
      imageUrl: row.imageKey ? `/api/listings/${row.id}/photo` : null,
    })),
  });
}
