# JY Trading Journal (Connected v0.9)

Next.js + Supabase connected architecture for auth, database persistence, and attachment storage.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file:
   ```bash
   cp .env.example .env.local
   ```
3. In Supabase:
   - enable Google provider in Auth
   - run `supabase/schema.sql`
4. Run app:
   ```bash
   npm run dev
   ```

## Notes

- AI extraction is **not implemented**.
- Uploads are stored attachments only.
- Auth is wired through Supabase OAuth (Google).
- Passkeys are not implemented yet, but auth structure is prepared for a next passkey/WebAuthn milestone.
Trigger new deployment
