# Quiz Loop on Vercel and Supabase

Vercel serves the Android-friendly frontend. Supabase Auth manages accounts. Supabase Postgres stores the question bank, attempts and individual revision schedules. The frontend uses authenticated database functions. The private recall schema does not need to be exposed in the Data API.

## Deploy

1. In your Supabase project's SQL Editor run the complete supabase/setup.sql. For an existing Quiz Loop database, use the same project to retain questions and progress. Enable email/password authentication and the Data API with public in its exposed schemas.
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

## Upgrading an existing installation

Run supabase/upgrade_quiz_loop.sql once in the existing Recall Studio / Quiz Loop database before deploying the updated frontend. For a fresh installation run supabase/setup.sql instead. Keep your existing project URL, public key and admin account. The schema and RPC prefixes remain recall for compatibility.

## Practice, quiz and corrections

Practice prioritises due questions. Correct streaks move through nominal intervals of 1, 3, 7, 14, 30 and 60 days. The last 19 practice outcomes for this learner and question scale the interval: a history of mistakes shortens the delay even after a correct answer. A miss resets the streak and schedules another review after 10 minutes divided by one plus the number of prior recent misses, with a one-minute minimum. These are adjustable study defaults. Previously scheduled questions adopt the new calculation on the next practice answer.

Save keeps a question for reference. Flag marks it for personal attention. Report error sends a note to the desktop admin report queue. An admin can correct the prompt, options, answer key and explanation or resolve the report without editing. Use the Saved tab to see both personal lists.

A timed quiz draws up to 100 distinct questions from selected subjects, spreading them across the subjects as availability permits. New selections save to Supabase. You can leave and resume while the timer continues. At the deadline the server stops accepting answers. Quiz scores are separate from practice scheduling. Starting a new quiz replaces the previous quiz result for that user.
