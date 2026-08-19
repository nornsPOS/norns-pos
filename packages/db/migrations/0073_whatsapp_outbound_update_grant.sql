-- ═════════════════════════════════════════════════════════════════════════
-- 0073 — whatsapp_outbound_messages: grant the settle UPDATE (record-intent send)
-- ═════════════════════════════════════════════════════════════════════════
--
-- The operator WhatsApp send (routes/whatsapp-inbox.ts) now records the message
-- INTENT as `status='queued'` BEFORE the external Meta call, then SETTLES the row
-- (status + provider_message_id + provider_error) after the call returns (P1.5).
-- Previously the row was INSERTed only AFTER a successful send, so the app role
-- had SELECT + INSERT but no UPDATE (0031). The settle step needs a column-scoped
-- UPDATE grant — without it Step C throws "permission denied".
--
-- Column-scoped (not table-wide) so the immutable columns (to_phone, body,
-- body_encrypted, sent_by_user_id, …) stay non-updatable by the app role.
-- Idempotent (GRANT is repeatable), append-only.

GRANT UPDATE (status, provider_message_id, provider_error)
  ON whatsapp_outbound_messages TO warehouse14_app;
