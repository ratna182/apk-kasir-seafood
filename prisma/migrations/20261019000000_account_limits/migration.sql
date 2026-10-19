-- Keep one owner account globally.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_owner_key"
  ON "users" ("role")
  WHERE "role" = 'OWNER';

-- Enforce the two-cashier limit in the database as well as the API.
CREATE OR REPLACE FUNCTION enforce_user_account_limits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."role" = 'KASIR' AND (
    TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD."role" <> 'KASIR')
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext('users-kasir-limit'));
    IF (SELECT COUNT(*) FROM "users" WHERE "role" = 'KASIR') >= 2 THEN
      RAISE EXCEPTION 'Maksimal 2 akun kasir sudah tercapai';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "users_account_limits_trigger" ON "users";
CREATE TRIGGER "users_account_limits_trigger"
  BEFORE INSERT OR UPDATE OF "role" ON "users"
  FOR EACH ROW EXECUTE FUNCTION enforce_user_account_limits();
