# Recall Studio on Vercel and Supabase

Vercel serves the Android-friendly frontend. Supabase Auth manages accounts. Supabase Postgres stores the question bank, attempts and individual revision schedules. The frontend uses authenticated database functions. The private recall schema does not need to be exposed in the Data API.

## Deploy

1. In your Supabase project's SQL Editor run the complete supabase/setup.sql. For an existing Recall Studio database, use the same project to retain questions and progress. Enable email/password authentication and the Data API with public in its exposed schemas.
2. Extract this ZIP and commit its contents to a GitHub repository. Place vercel.json, build.mjs, web/ and supabase/ together at the repository root.
3. Import the repository into Vercel. Choose Other for the framework and the repository root for Root Directory. The included vercel.json sets the build command and output directory. All browser libraries are bundled.
4. Before deploying, add SUPABASE_URL (the project HTTPS URL) and SUPABASE_PUBLISHABLE_KEY (the public key starting with sb_publishable_) to Production. Configure Preview separately if you use preview deployments. These two values are shipped to the browser. Keep database passwords, service-role keys and secret keys out of the frontend.
5. Deploy. In Supabase Authentication → URL Configuration, set Site URL to the final production HTTPS origin. Enable new-user signups if students will register themselves. With email confirmation enabled, configure email delivery for your intended users.
6. Open the Vercel app, create your account and confirm the email if requested. Copy your UUID from Supabase Authentication → Users and run the following once in SQL Editor with your real UUID. Reload the app to access Admin.

```sql
insert into recall.admins (user_id)
values ('YOUR-USER-UUID')
on conflict do nothing;
```

## First use

In Admin, add a subject and chapter, or choose Excel import to download a workbook. Use one question per row and put the correct answer in Option A. Leave Deck blank for chapter-level questions. New Supabase projects start with an empty question bank. Browser-only sample attempts from the old demo are separate from authenticated records.

To verify the deployment, import one question as admin, answer it using a student account, then sign in as the same student on another device and check the chapter progress. The student account should have no Admin tab. After changing Vercel environment variables, redeploy.

## Local build

With Node.js 20+ and the two environment variables set, run `node build.mjs`, then serve dist/ using a local static web server. No npm dependencies are required.
