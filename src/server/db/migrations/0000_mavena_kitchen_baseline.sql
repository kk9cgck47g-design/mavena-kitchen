CREATE TYPE "public"."admin_role" AS ENUM('OWNER', 'MANAGER');--> statement-breakpoint
CREATE TYPE "public"."city_code" AS ENUM('YEREVAN');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('TELEGRAM');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('NEW_ORDER');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."option_group_type" AS ENUM('SINGLE', 'MULTI');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('AWAITING_PAYMENT', 'NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('DELIVERY', 'PICKUP');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'CARD_ON_DELIVERY', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "admin_role" DEFAULT 'MANAGER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"sessions_valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"code" "city_code" PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"default_zoom" smallint DEFAULT 14 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_code" "city_code" NOT NULL,
	"name" jsonb NOT NULL,
	"polygon" jsonb NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"min_order" integer DEFAULT 0 NOT NULL,
	"free_delivery_from" integer,
	"eta_minutes" integer DEFAULT 45 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"deliveries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"type" "option_group_type" NOT NULL,
	"min_select" smallint DEFAULT 0 NOT NULL,
	"max_select" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"by_user_id" uuid,
	"source" text DEFAULT 'ADMIN' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name_snapshot" jsonb NOT NULL,
	"image_snapshot" text,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"options_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_code" text NOT NULL,
	"tracking_token" text NOT NULL,
	"type" "order_type" NOT NULL,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"city_code" "city_code",
	"address" text,
	"landmark" text,
	"lat" double precision,
	"lng" double precision,
	"zone_id" uuid,
	"notes" text,
	"scheduled_for" timestamp with time zone,
	"eta_minutes" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"payment_expires_at" timestamp with time zone,
	"subtotal" integer NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"promo_code_id" uuid,
	"idempotency_key" text NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"redirect_url" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failure_reason" text,
	"needs_refund" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"base_price" integer NOT NULL,
	"images" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"weight_grams" integer,
	"calories" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"min_order" integer DEFAULT 0 NOT NULL,
	"max_discount" integer,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"per_phone_limit" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_accepting_orders" boolean DEFAULT true NOT NULL,
	"paused_message" jsonb,
	"working_hours" jsonb NOT NULL,
	"prep_time_minutes" integer DEFAULT 30 NOT NULL,
	"pre_order_days_ahead" integer DEFAULT 2 NOT NULL,
	"phones" text[] DEFAULT '{}' NOT NULL,
	"address_line" jsonb,
	"lat" double precision,
	"lng" double precision,
	"socials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telegram_chat_ids" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stub_payments" (
	"external_id" text PRIMARY KEY NOT NULL,
	"amount" integer NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"label" text,
	"return_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_by_user_id_admin_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_sort_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "delivery_zones_city_idx" ON "delivery_zones" USING btree ("city_code","priority");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_order_idx" ON "notifications" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_order_kind_key" ON "notifications" USING btree ("order_id","channel","kind");--> statement-breakpoint
CREATE INDEX "option_groups_product_idx" ON "option_groups" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "options_group_idx" ON "options" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_public_code_key" ON "orders" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tracking_token_key" ON "orders" USING btree ("tracking_token");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_awaiting_payment_idx" ON "orders" USING btree ("status","payment_expires_at");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_key" ON "payments" USING btree ("provider","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_paid_per_order" ON "payments" USING btree ("order_id") WHERE status = 'PAID';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_pending_per_order" ON "payments" USING btree ("order_id") WHERE status = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_key" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "rate_limits_updated_idx" ON "rate_limits" USING btree ("updated_at");--> statement-breakpoint

-- The delivery area ships with the schema.
--
-- A migrated database is expected to be usable before anything else runs, and
-- the ordinary seed deliberately refuses to run over existing orders — so a
-- deployment that relied on a post-migration seed for its geography would find
-- itself with a menu it cannot deliver. Keeping the inserts in the same
-- transaction as the tables also means the application can never observe the
-- `city_code` enum without the city it names.
--
-- The values are duplicated from `delivery-data.ts` because a migration is an
-- immutable deployment artifact and cannot import application code. The seed
-- rewrites both tables from that file, so the two agree by construction on any
-- database that has been seeded.
INSERT INTO "cities" (
	"code",
	"name",
	"center_lat",
	"center_lng",
	"default_zoom",
	"is_active",
	"sort_order"
) VALUES (
	'YEREVAN',
	'{"hy":"Երևան","ru":"Ереван","en":"Yerevan"}'::jsonb,
	40.1830,
	44.5140,
	12,
	true,
	0
);--> statement-breakpoint

INSERT INTO "delivery_zones" (
	"city_code",
	"name",
	"polygon",
	"fee",
	"min_order",
	"free_delivery_from",
	"eta_minutes",
	"is_active",
	"priority"
) VALUES
(
	'YEREVAN',
	'{"hy":"Կենտրոնական գոտի","ru":"Центральная зона","en":"Central zone"}'::jsonb,
	'{"type":"Polygon","coordinates":[[[44.5,40.176],[44.509,40.171],[44.521,40.173],[44.529,40.18],[44.528,40.189],[44.519,40.195],[44.506,40.193],[44.499,40.185],[44.5,40.176]]]}'::jsonb,
	400,
	2000,
	6000,
	25,
	true,
	0
),
(
	'YEREVAN',
	'{"hy":"Միջին գոտի","ru":"Средняя зона","en":"Inner zone"}'::jsonb,
	'{"type":"Polygon","coordinates":[[[44.478,40.166],[44.495,40.156],[44.518,40.154],[44.54,40.162],[44.552,40.178],[44.554,40.196],[44.542,40.21],[44.52,40.217],[44.496,40.21],[44.48,40.193],[44.478,40.166]]]}'::jsonb,
	700,
	3000,
	10000,
	40,
	true,
	10
),
(
	'YEREVAN',
	'{"hy":"Արտաքին գոտի","ru":"Внешняя зона","en":"Outer zone"}'::jsonb,
	'{"type":"Polygon","coordinates":[[[44.43,40.145],[44.47,40.125],[44.52,40.122],[44.565,40.135],[44.59,40.16],[44.595,40.19],[44.585,40.22],[44.555,40.24],[44.51,40.245],[44.465,40.235],[44.435,40.21],[44.425,40.178],[44.43,40.145]]]}'::jsonb,
	1100,
	4000,
	15000,
	60,
	true,
	20
);
