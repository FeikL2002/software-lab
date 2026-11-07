import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  title: text("title").notNull(),
  location: text("location").notNull(),
  startDate: text("start_date").notNull(),
  description: text("description").notNull().default(""),
  photoKey: text("photo_key"),
  status: text("status").notNull().default("active"),
  pricePaidCents: integer("price_paid_cents").notNull().default(2000),
  views: integer("views").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const appProblems = sqliteTable("app_problems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  message: text("message").notNull(),
  page: text("page").notNull(),
  createdAt: text("created_at").notNull(),
});

export const savedListings = sqliteTable("saved_listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  listingId: integer("listing_id").notNull(),
  createdAt: text("created_at").notNull(),
});
