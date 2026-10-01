# Pending Supabase migrations

These SQL files are **not confirmed as applied to the live OrbitFS Base database**.

Do not run them until the correct Supabase account/project for `V1-vercel-base` has been explicitly verified.

Current pending scope:
- users / user schema hardening
- user groups and group memberships
- effective user permission support
- workspace membership and file-permission contract
- registration request persistence
- Add-on Manager persistence contract

When the correct Base Supabase project is connected, validate the live schema first, then apply only the required portions.
