# OrbitFS Base database migrations

This directory is the authoritative ordered Base schema history used to build fresh customer databases.

Rules:

- Files are timestamped `YYYYMMDDHHMMSS_description.sql` migrations.
- Once a migration is part of an approved/published Base release, never edit, rename, or delete it. Add a new forward migration.
- The Dev Panel Base packaging worker composes the complete ordered history into `supabase/customer-schema.sql`, records every migration ID/path/SHA-256 in release metadata, and packages the snapshot with the Base artifact.
- Foundational/destructive Base schema work must be deliberate and release-controlled. Normal customer feature evolution should use Engine/Update migrations instead.
