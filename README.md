# OrbitFS V1 Vercel Base

`V1-vercel-base` is the main OrbitFS Panel/control plane for the Vercel + Supabase build.

## Base owns

- User authentication, registration and permissions
- Workspaces and workspace membership
- Library, Knowledge and Profiles
- Core Library, Knowledge and Profiles state
- Generic add-on installation/linkage state
- Licensing and installation identity
- Add-on install, attach, detach and entitlement state
- The shared Supabase-backed file/library model
- Base release/version coordination and pre-update checkpoints

MCP, APEX and Studio runtime setup/monitoring belong to `V1-vercel-engine`. They are not linked during first-time Base setup. Keeping the Engine Host separate means a clean Base install never needs an Engine deployment, while installed engine-backed add-ons can still be updated by redeploying the existing Engine project later.

## First-time setup

1. Deploy the Panel to Vercel.
2. Configure the required server environment from `.env.example`.
3. Apply the OrbitFS Base database schema to the shared Supabase project.
4. Activate the OrbitFS Base System licence.
5. Open `/setup` and run **Prepare Base**. This verifies required tables and creates the private `orbitfs-files` bucket when needed.
6. Create the first Owner. OrbitFS creates or repairs the main `Public Workspace`, Owner membership and protected core folders.
7. Sign in normally.
8. Install MCP, APEX or Studio later from Add-on management. Panel validates entitlement/install state, attaches the engine to the shared Engine Host and then Engine first-time setup continues on `V1-vercel-engine`.

## Release model

`V1-vercel-base` is the Base/Panel release source. `base-release` is the controlled source branch inspected by Dev Panel before packaging. License Master records the exact Base version, source branch and source commit used for an immutable release.

`base-release` is the controlled Base source branch. Changes intended for a Base release must be merged into `base-release` first; Dev Panel then packages the exact inspected commit.

The separate existing-installation update-release system is **not** a Base release branch. Engine/add-on update candidates are produced by `V1-vercel-engine` on its `UPDATE_RELEASE` branch. That branch is specifically for the update-release workflow and is separate from Billing Store deployment control.

## Deployment and update model

OrbitFS has two update paths only:

- **Base Deployer** owns both the first Base installation and later Base updates. First install may create the Vercel Base project. A Base update must target the registered `installation.route.projectId` and create a new deployment inside that same Vercel project. It must never create or silently adopt a replacement Base project.
- **Normal Updater** owns Engine/add-on updates for APEX, MCP and Studio. It uses `ORBITFS_UPDATE_CHANNEL` (normally `stable`) and does not carry Base files. Engine updates also remain locked to the registered Shared Engine Vercel project after first deployment.

The Base release channel and the normal update channel are intentionally separate. `ORBITFS_RELEASE_CHANNEL` describes Base release delivery; `ORBITFS_UPDATE_CHANNEL` describes normal Engine/add-on update delivery.

## Base release pipeline

Base release packaging is owned by the Dev Panel Stage 1 worker, not this repository.

The Dev Panel worker checks out the exact inspected `V1-vercel-base` source commit, validates/builds it, composes `supabase/customer-schema.sql` from the authoritative migration chain, creates the deployable Base artifact and matching schema metadata/checksums, stores the package, and hands the candidate to License Master for technical validation and approval.

This repository remains the Base source/runtime and database migration source of truth. It does not own release packaging, release publication, or License Master handoff credentials.

## Required environment

The hard requirements are:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (client/public Supabase key)
- `SUPABASE_SECRET_KEY` (server-side privileged Supabase key; required for RLS-protected Base tables)
- `ORBITFS_DB_SECRET` (separate OrbitFS application secret used for encrypted deployment credentials / Engine fallback)

Canonical service URL overrides and optional licence tuning are documented in `.env.example`. Vercel environment variables are separate from the GitHub Actions release credentials above.

## Setup readiness

The Base setup service checks these core tables before allowing Owner creation:

- `orbitfs_users`
- `orbitfs_workspaces`
- `orbitfs_workspace_members`
- `orbitfs_files`
- `orbitfs_settings`
- `orbitfs_license`
- `orbitfs_addons`
- `orbitfs_audit_log`

It also checks the `orbitfs-files` Supabase Storage bucket, Base System licence, active Owner and main workspace. Setup is only considered complete when all Base requirements are actually ready.

## Database source of truth

Fresh Base installs use the ordered SQL chain in `supabase/migrations/` as immutable historical lineage. The snapshot builder composes that history and then applies a **fresh-install-only component boundary** so the final `supabase/customer-schema.sql` contains Base-owned schema only.

Historical migrations are never rewritten or deleted. Older migrations that once created MCP/Studio objects remain in lineage for compatibility, but the generated fresh-install snapshot removes Engine/add-on tables, views and routines before packaging. MCP, APEX and Studio database objects are supplied later by the central customer database package registry when those components are installed.

The component boundary is recorded in Base database metadata and release manifests. It is not a forward migration and must never be used to remove add-on data from an existing customer database.

`supabase/phase1.sql` remains a legacy helper only and must not be used as the fresh-install schema. Add Base-owned schema changes as new timestamped migrations; add Engine/add-on schema changes in `V1-vercel-engine`. Run `npm run db:snapshot` locally when you want to inspect the composed Base-only customer schema.

## Development

```bash
npm install
npm run check
npm run build
```
## Automated deployment environment contract

Automated Base deployers should read `deployment/base-environment.json` first and use it as the machine-readable environment contract. `.env.example` is the human-readable equivalent. The deployer must populate deployment-context values and secrets rather than searching the source tree for environment names.

Production defaults are centralized on the License Master API `https://incendiarynetworks.cc/api` and the production Panel origin `https://panel.incendiarynetworks.cc`. Customer-specific Vercel deployments may override `ORBITFS_PANEL_URL` with their actual public HTTPS deployment URL; when it is omitted, Base can derive the public Vercel URL from Vercel's deployment environment.
