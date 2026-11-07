import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  price: text("price").notNull(),
  condition: text("condition").notNull(),
  details: text("details").notNull().default(""),
  photoKeys: text("photo_keys").notNull().default("[]"),
  status: text("status").notNull().default("pending_payment"),
  stripeSessionId: text("stripe_session_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
