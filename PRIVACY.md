# Privacy

Wayfinder is designed for local-first planning. The core workflow keeps the active plan in browser storage on the device and uses files only when the user explicitly exports or imports them. The application does not require an account or a remote data store for this workflow.

## What can be sensitive

A document can contain compensation assumptions, household costs, ongoing commitments, investment plans, research notes, source URLs, and scenario metadata. An editable JSON export includes the complete saved model. A read-only family HTML view includes calculations, assumptions, evidence labels, and research selected for that report.

Treat both formats as sensitive. Keep them out of public repositories, issue trackers, chat transcripts, screenshots, and shared devices. The repository contains only empty defaults and fictional examples.

## Optional runtime starter document

`python scripts/dev.py --document <path>` is deliberately opt-in and available
on Windows only. On other platforms, use the browser import flow, which works
everywhere. On Windows it copies a
validated v5 document to a per-user Windows Local AppData artifact outside the
repository and supplies it to every browser that can reach that one running
instance. This is convenient for a
trusted local session, but it is not access control: use loopback only, or put
remote access behind a trusted authenticated gateway. The source path is never
sent to the browser. Each seeded launcher owns and removes only its own
per-user Windows Local AppData artifact, outside the repository, when it exits;
an unseeded or concurrent launch never deletes another
running instance's artifact. A small per-seed PID lease lets the next launcher
remove only artifacts whose recorded owner has exited. Malformed or unreadable
leases are preserved fail-safe; confirm no seeded process is active before
manually removing such leftovers from the Wayfinder runtime-seeds directory in
your Windows Local AppData folder.

On Windows, a seeded launcher joins a kill-on-close Job Object before creating
the private artifact. This keeps its npm/Node process tree tied to the
launcher's lifetime, and the lease records process creation identity as well as
PID. If containment cannot be established, the seeded start fails before an
artifact is created.

Seed validation errors use a constant label and never print the source path or
filename. Production builds and previews ignore runtime-seed control variables;
only the explicit local development launcher can inject a starter document. If
seed mode is enabled without both its opaque identifier and the exact absolute
runtime-seeds directory, Vite refuses to start rather than reading a repository
path or another file.

## Local storage and deletion

Browser storage is specific to the browser profile and device. Clearing the dashboard removes the stored Wayfinder documents from that browser; it cannot remove copies previously exported or shared. Export a backup before clearing if one is needed.

To prevent two open tabs from saving or clearing over each other, every mutation uses a dedicated local IndexedDB object store as its shared lock domain. In browsers that support the Web Locks API, an exclusive Web Lock wraps that same IndexedDB transaction. The object store's only record is a coordination marker with a last-use timestamp. That marker contains no plan, financial, household, research, source, or identity data. The database connection is closed after each operation; the tiny marker may remain until browser site data is cleared. If the common IndexedDB lock cannot be established, Wayfinder leaves the saved dashboard unchanged.

## Imports and links

Importing is validated and requires confirmation before it replaces the active dashboard. Research URLs are stored as user-provided text. In the family view, a valid HTTPS link opens only when selected; the report does not automatically retrieve research updates.

## Data minimization

Record only what helps compare options. Use high-level evidence references instead of documents containing unnecessary personal information. Mark unknown inputs as unknown, use estimates cautiously, and remove stale exports when no longer needed.
