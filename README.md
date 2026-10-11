# Cainta Crime Map

Static front end (HTML, CSS, ES modules) backed by Supabase Auth and Postgres.

## Structure

```
index.html
css/styles.css
js/        config, constants, util, state, api, auth, map, sidebar, tabs,
           dashboard, encoder, analysis, audit, theme, data, refresh, main
supabase/schema.sql
```

## Setup

1. Create a Supabase project.
2. In the SQL editor, run `supabase/schema.sql`.
3. Authentication, Providers, Email: turn off "Allow new users to sign up". Create each user under Authentication, Users, with "Auto Confirm User" checked.
4. Give each user a role (new users default to `viewer`):

```sql
update public.profiles set role = 'admin', display_name = 'Admin' where id = (select id from auth.users where email = 'you@example.com');
```

Roles: `admin` (everything, can purge), `officer` (encode, import, soft delete, restore, audit log), `viewer` (read only).

5. Edit `js/config.js` with the project URL and the anon public key. Never put the `service_role` key in the front end.
6. Serve the folder over HTTPS (Netlify, Cloudflare Pages, Vercel, GitHub Pages) or locally with `npx serve .`.

## Optional hardening

- Auth, Settings: set a minimum password length of 12, enable leaked password protection, enable MFA.
- Auth, URL Configuration: set Site URL to the deployed address only.
- Restrict the Carto key to the deployed domain in the Carto dashboard.
- Add the CSP and `X-Frame-Options: DENY` as real response headers on the host (the meta tag cannot set `frame-ancestors`).
- Pin each CDN script with an `integrity` attribute (`openssl dgst -sha384 -binary FILE | openssl base64 -A`).
- Purge expired deleted records on a schedule (requires pg_cron):

```sql
select cron.schedule('purge-deleted-incidents', '0 * * * *', 'select public.purge_deleted_incidents()');
```
