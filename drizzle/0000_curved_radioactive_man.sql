CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'edited', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('active', 'disabled', 'pending');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('whatsapp', 'instagram', 'gbm');--> statement-breakpoint
CREATE TYPE "public"."conv_status" AS ENUM('open', 'waiting_approval', 'closed');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."intent_state" AS ENUM('manual', 'auto_candidate', 'auto');--> statement-breakpoint
CREATE TYPE "public"."kb_type" AS ENUM('faq', 'price', 'service', 'hours', 'location', 'policy');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'qualified', 'hot', 'booked', 'lost');--> statement-breakpoint
CREATE TYPE "public"."msg_status" AS ENUM('received', 'draft', 'pending_approval', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('telegram', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('starter', 'growth', 'scale');--> statement-breakpoint
CREATE TYPE "public"."risk_class" AS ENUM('low', 'med', 'high', 'never_auto');--> statement-breakpoint
CREATE TYPE "public"."sender_type" AS ENUM('customer', 'ai', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'paused', 'churned');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'staff', 'internal_admin');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid NOT NULL,
	"calendar_event_id" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"service" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"draft_message_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"owner_action" text,
	"action_by" uuid,
	"delivery_channel" "notify_channel" DEFAULT 'telegram' NOT NULL,
	"notif_ref" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"entity" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"token_ciphertext" text NOT NULL,
	"refresh_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "channel_type" DEFAULT 'whatsapp' NOT NULL,
	"provider" text DEFAULT 'meta' NOT NULL,
	"provider_account_id" text,
	"provider_number_id" text NOT NULL,
	"display_number" text,
	"status" "channel_status" DEFAULT 'pending' NOT NULL,
	"quality_rating" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"basis" text NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wa_id" text,
	"phone" text,
	"ig_id" text,
	"name" text,
	"locale" text,
	"consent_status" text DEFAULT 'implied' NOT NULL,
	"opt_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" "conv_status" DEFAULT 'open' NOT NULL,
	"last_customer_msg_at" timestamp with time zone,
	"window_expires_at" timestamp with time zone,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intent_key" text NOT NULL,
	"risk_class" "risk_class" DEFAULT 'med' NOT NULL,
	"state" "intent_state" DEFAULT 'manual' NOT NULL,
	"approve_clean" integer DEFAULT 0 NOT NULL,
	"edited" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"clean_rate" numeric DEFAULT '0' NOT NULL,
	"graduated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "kb_type" NOT NULL,
	"question" text,
	"answer" text,
	"structured_data" jsonb,
	"embedding" vector(768),
	"is_active" boolean DEFAULT true NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"captured_fields" jsonb,
	"value_estimate" numeric,
	"owner_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"sender_type" "sender_type" NOT NULL,
	"channel_msg_id" text,
	"content" text,
	"media_ref" text,
	"intent" text,
	"language" text,
	"confidence" numeric,
	"cited_kb_ids" uuid[],
	"status" "msg_status" DEFAULT 'received' NOT NULL,
	"template_name" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roi_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"enquiries_handled" integer DEFAULT 0 NOT NULL,
	"leads_captured" integer DEFAULT 0 NOT NULL,
	"appointments_booked" integer DEFAULT 0 NOT NULL,
	"revenue_recovered_est" numeric DEFAULT '0' NOT NULL,
	"avg_response_time_s" integer DEFAULT 0 NOT NULL,
	"auto_send_rate" numeric DEFAULT '0' NOT NULL,
	"pdf_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" "plan" DEFAULT 'starter' NOT NULL,
	"razorpay_subscription_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"setup_paid" boolean DEFAULT false NOT NULL,
	"mrr" numeric DEFAULT '0' NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vertical" text,
	"plan" "plan" DEFAULT 'starter' NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"locale_default" text DEFAULT 'hi-IN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"persona" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"auth_id" text,
	"notify_channel" "notify_channel" DEFAULT 'telegram' NOT NULL,
	"telegram_chat_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approval_tasks_tenant_idx" ON "approval_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_draft_idx" ON "approval_tasks" USING btree ("draft_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_provider_number_idx" ON "channels" USING btree ("provider_number_id");--> statement-breakpoint
CREATE INDEX "channels_tenant_idx" ON "channels" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_wa_idx" ON "contacts" USING btree ("tenant_id","wa_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_policies_tenant_intent_idx" ON "intent_policies" USING btree ("tenant_id","intent_key");--> statement-breakpoint
CREATE INDEX "kb_tenant_idx" ON "knowledge_base_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_channel_msg_idx" ON "messages" USING btree ("channel_msg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_channel_msg_uq" ON "messages" USING btree ("tenant_id","channel_msg_id") WHERE "messages"."channel_msg_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "roi_reports_tenant_period_idx" ON "roi_reports" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_telegram_idx" ON "users" USING btree ("telegram_chat_id");