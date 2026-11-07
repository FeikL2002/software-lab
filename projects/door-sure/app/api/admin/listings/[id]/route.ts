import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db";
import { listings } from "../../../../../db/schema";

function isAdmin(email: string) {
  return Boolean(
    process.env.DOORSURE_ADMIN_EMAIL &&
      email.toLowerCase() === process.env.DOORSURE_ADMIN_EMAIL.toLowerCase(),
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user || !isAdmin(user.email)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = (await request.json()) as { status?: string };
  if (!["approved", "rejected", "pending"].includes(body.status ?? "")) {
    return Response.json({ error: "Invalid review status" }, { status: 400 });
  }
  const [listing] = await getDb()
    .update(listings)
    .set({ status: body.status! })
    .where(eq(listings.id, Number(id)))
    .returning();
  if (!listing) return Response.json({ error: "Property not found" }, { status: 404 });
  return Response.json({ listing });
}
