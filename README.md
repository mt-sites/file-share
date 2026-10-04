# File Share (Cloudflare Workers + R2)

Public file list with Download buttons and a search box. The owner logs in with a password to upload (up to 5 GB total) and delete.

## Setup
1. Create an R2 bucket named `file-share` (Cloudflare dashboard > R2, or `npx wrangler r2 bucket create file-share`).
2. Connect this repo in Cloudflare (Workers & Pages > Create > Import a repository). Deploy command: `npx wrangler deploy`.
3. In the Worker's Settings > Variables and Secrets, add a **Secret** named `ADMIN_PASSWORD`.

Never commit the password to this repo.
