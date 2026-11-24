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

To verify the deployment, import one question as admin, approve the student under Admin → User approvals, answer it using that student account, then sign in as the same student on another device and check the chapter progress. The student account should have no Admin tab. After changing Vercel environment variables, redeploy.

## Local build

With Node.js 20+ and the two environment variables set, run `node build.mjs`, then serve dist/ using a local static web server. No npm dependencies are required.

## Upgrading an existing installation

Run supabase/upgrade_quiz_loop.sql once in the existing Recall Studio / Quiz Loop database before deploying the updated frontend. For a fresh installation run supabase/setup.sql instead. Keep your existing project URL, public key and admin account. The schema and RPC prefixes remain recall for compatibility.

## Practice, quiz and corrections

Practice draws one eligible card at a time. Each ten practice answers on the learner’s local day target six new, three previously wrong and one previously correct question. The daily position follows the account across sessions. Unavailable buckets yield to overdue reviews first, then new questions. Subject, chapter and deck sessions use the same rule within the selected scope. Practice continues until the learner exits or the scope has no eligible cards.

A wrong answer clears the correct streak, including on a learned question, and makes the card eligible again after 10 minutes. Three consecutive correct scheduled answers mark it learned. After successive correct answers the waits are 1, 3, 7, 14, 30 and 60 days, then 60 days after each further success. Existing due dates and streaks carry forward until the next answer. The percentage is learned questions divided by all questions. Green indicates learned, red indicates attempted and still learning, and grey indicates unseen.

Once every question in a deck has been attempted, its detail screen offers Reset deck progress. This restarts that learner’s schedule, preserving historical attempts and personal saved items.

New and existing non-admin accounts need approval in Admin → User approvals. Existing admin memberships grant access immediately. Supabase Auth verifies identity first. All study data and actions require approval in the database.

Flag sends a question to the admin Flagged questions tab and adds it to the learner’s flagged list. Saving a correction there clears the flags for that question. Save is personal. Report error accepts a written note and remains available under Question bank.

Under Manage catalogue, rename, delete or merge subjects, chapters and decks. Merge preserves question IDs and learner progress, combining same-named child containers. If two questions have the same prompt in the destination, the transaction stops so the administrator can reconcile the duplicate. Deletion removes descendant questions and their practice histories for all learners. Existing timed quizzes retain their original snapshots.

A timed quiz draws up to 100 distinct questions from selected subjects, spreading them across the subjects as availability permits. New selections save to Supabase. You can leave and resume while the timer continues. At the deadline the server stops accepting answers. Quiz scores are separate from practice scheduling. Starting a new quiz replaces the previous quiz result for that user.
