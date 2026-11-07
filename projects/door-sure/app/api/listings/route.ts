import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { listings } from "../../../db/schema";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table")) {
    return "Listing storage is still being prepared. Please try again shortly.";
  }
  return message;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  try {
    const rows = await getDb()
      .select()
      .from(listings)
      .where(eq(listings.ownerEmail, user.email))
      .orderBy(desc(listings.createdAt));
    return Response.json({ listings: rows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const address = String(body.address ?? "").trim();
    const city = String(body.city ?? "").trim();
    const zip = String(body.zip ?? "").trim();
    const role = String(body.role ?? "").trim();
    const propertyType = String(body.propertyType ?? "").trim();
    const verificationMethod = String(body.verificationMethod ?? "").trim();
    const beds = Number(body.beds);
    const baths = Number(body.baths);
    const monthlyRent = Number(body.monthlyRent);

    if (
      !address ||
      !city ||
      !/^\d{5}$/.test(zip) ||
      !role ||
      !propertyType ||
      !verificationMethod ||
      !Number.isFinite(beds) ||
      !Number.isFinite(baths) ||
      !Number.isFinite(monthlyRent) ||
      monthlyRent < 1
    ) {
      return Response.json(
        { error: "Please complete every property field." },
        { status: 400 },
      );
    }

    const [listing] = await getDb()
      .insert(listings)
      .values({
        ownerEmail: user.email,
        address,
        city,
        state: "OH",
        zip,
        role,
        propertyType,
        beds,
        baths,
        monthlyRent,
        verificationMethod,
      })
      .returning();

    return Response.json({ listing }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
