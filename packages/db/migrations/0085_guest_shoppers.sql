-- 0085_guest_shoppers.sql
--
-- Guest shopping (storefront app + web): a guest is a REAL shopper row with
-- is_guest = TRUE, minted lazily on the first cart action. This keeps every
-- downstream table untouched (shopper_sessions, carts, cart_items, orders all
-- key on shoppers.id) while making guestness explicit and queryable.
--
-- A guest row carries a synthetic unique email (gast-<uuid>@gast.invalid,
-- encrypted like any other) and NO credential — the relaxed check below
-- permits that ONLY for guest rows. Sign-in with a synthetic address is
-- impossible: the address is never disclosed and has no password.
--
-- Upgrade paths:
--   • Email sign-up from a guest session upgrades the SAME row in place
--     (real email + password, is_guest = FALSE) so the cart survives.
--   • Reserve-and-pickup writes the guest's real contact (name/email/phone)
--     onto the linked customers row so staff see who is picking up.

ALTER TABLE shoppers ADD COLUMN is_guest boolean NOT NULL DEFAULT false;

ALTER TABLE shoppers DROP CONSTRAINT shoppers_has_credential;
ALTER TABLE shoppers ADD CONSTRAINT shoppers_has_credential
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL OR is_guest);

-- Sweep support: abandoned guest rows (no orders, old) can be purged later.
CREATE INDEX shoppers_guest_created_idx ON shoppers (created_at) WHERE is_guest;
