import { desc } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { listings } from "../../../../db/schema";

function isAdmin(email: string) {
  return Boolean(
    process.env.DOORSURE_ADMIN_EMAIL &&
      email.toLowerCase() === process.env.DOORSURE_ADMIN_EMAIL.toLowerCase(),
  );
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !isAdmin(user.email)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const rows = await getDb()
    .select()
    .from(listings)
    .orderBy(desc(listings.createdAt));
  return Response.json({ listings: rows });
}
