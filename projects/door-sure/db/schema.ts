import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull().default("OH"),
  zip: text("zip").notNull(),
  role: text("role").notNull(),
  propertyType: text("property_type").notNull(),
  beds: integer("beds").notNull(),
  baths: integer("baths").notNull(),
  monthlyRent: integer("monthly_rent").notNull(),
  verificationMethod: text("verification_method").notNull(),
  imageKey: text("image_key"),
  imageContentType: text("image_content_type"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const inquiries = sqliteTable("inquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listings.id),
  renterEmail: text("renter_email").notNull(),
  landlordEmail: text("landlord_email").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
