-- 0082_grant_mcp_audit_update.sql
--
-- Der Fernwerkzeug-Verteiler audits every tool call with an open/close pattern: it
-- INSERTs an IN_FLIGHT row (auditOpen) and then UPDATEs it to SUCCESS/FAILED
-- (auditClose). warehouse14_app held INSERT + SELECT on mcp_tool_invocations
-- but NOT UPDATE, so auditClose threw "permission denied for table
-- mcp_tool_invocations" (SQLSTATE 42501) and EVERY Fernwerkzeug call failed AFTER
-- its handler ran. The Vierzehn voice assistant could therefore read nothing:
-- situation_report, find_customer, find_product, sales_report, finance_overview,
-- agenda and open_dev_ticket all crashed at the audit-close step.
--
-- Grant ONLY UPDATE on the app's own audit table. mcp_tool_invocations is NOT a
-- fiscal record and is designed to be updated (open -> close), so this does not
-- weaken the fiscal-immutability discipline (transactions, ledger_events,
-- audit_log, tse_* remain no-UPDATE/no-DELETE for warehouse14_app). Idempotent:
-- re-granting an already-held privilege is a no-op.

GRANT UPDATE ON TABLE mcp_tool_invocations TO warehouse14_app;
