# Privacy

Wayfinder is designed for local-first planning. The core workflow keeps the active plan in browser storage on the device and uses files only when the user explicitly exports or imports them. The application does not require an account or a remote data store for this workflow.

## What can be sensitive

A document can contain compensation assumptions, household costs, ongoing commitments, investment plans, research notes, source URLs, and scenario metadata. An editable JSON export includes the complete saved model. A read-only family HTML view includes calculations, assumptions, evidence labels, and research selected for that report.

Treat both formats as sensitive. Keep them out of public repositories, issue trackers, chat transcripts, screenshots, and shared devices. The repository contains only empty defaults and fictional examples.

## Local storage and deletion

Browser storage is specific to the browser profile and device. Clearing the dashboard removes the stored Wayfinder documents from that browser; it cannot remove copies previously exported or shared. Export a backup before clearing if one is needed.

To prevent two open tabs from saving or clearing over each other, every mutation uses a dedicated local IndexedDB object store as its shared lock domain. In browsers that support the Web Locks API, an exclusive Web Lock wraps that same IndexedDB transaction. The object store's only record is a coordination marker with a last-use timestamp. That marker contains no plan, financial, household, research, source, or identity data. The database connection is closed after each operation; the tiny marker may remain until browser site data is cleared. If the common IndexedDB lock cannot be established, Wayfinder leaves the saved dashboard unchanged.

## Imports and links

Importing is validated and requires confirmation before it replaces the active dashboard. Research URLs are stored as user-provided text. In the family view, a valid HTTPS link opens only when selected; the report does not automatically retrieve research updates.

## Data minimization

Record only what helps compare options. Use high-level evidence references instead of documents containing unnecessary personal information. Mark unknown inputs as unknown, use estimates cautiously, and remove stale exports when no longer needed.
