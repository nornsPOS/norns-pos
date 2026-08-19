-- Migration 0084 — staff provisioning function (Track A3).
--
-- The app role is intentionally REVOKEd from writing `users.role` / `is_owner`
-- (migrations 0004 + 0014), so a runtime "add a staff member" surface cannot
-- write the role directly. This SECURITY DEFINER function is the admin-mediated
-- path: it runs as its owner (the migrator, which owns `users`), so it may set
-- the role, and EXECUTE is granted to the app role. The calling route gates it
-- with Owner + PIN step-up, exactly like the ledger's SECURITY DEFINER chain.
--
-- It provisions ADMIN / CASHIER / READONLY only — it NEVER touches `is_owner`
-- (the single-Owner invariant stays migrator/seed-managed). Upsert by active
-- email: a returning staff member's role + name are updated, not duplicated.

CREATE OR REPLACE FUNCTION provision_staff(
  p_email citext,
  p_name  text,
  p_role  user_role
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_role NOT IN ('ADMIN', 'CASHIER', 'READONLY') THEN
    RAISE EXCEPTION 'invalid role %', p_role;
  END IF;
  IF length(coalesce(p_name, '')) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;

  INSERT INTO users (email, email_verified, name, role, is_owner)
  VALUES (p_email, TRUE, p_name, p_role, FALSE)
  ON CONFLICT (email) WHERE (soft_deleted_at IS NULL)
  DO UPDATE SET
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    email_verified = TRUE,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- The app may EXECUTE the mediated function (the route enforces Owner + step-up),
-- but still cannot UPDATE role/is_owner directly.
GRANT EXECUTE ON FUNCTION provision_staff(citext, text, user_role) TO warehouse14_app;
