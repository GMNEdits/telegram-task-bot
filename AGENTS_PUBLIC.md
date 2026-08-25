# Telegram Task Bot — Full Documentation

## What This Is
A Telegram group bot for small field teams to log complaints/tasks, track who's working on what, and auto-summarize daily progress. Runs on Node.js on Windows. Uses a Supabase project for data storage.

---

## Key Files
| File | Purpose |
|---|---|
| `index.js` | Main bot code (polling, buttons, alerts, EOD, team list) |
| `config.js` | Owner-adjustable settings (timings, language) — edit freely |
| `.env` | Secrets (bot token, Supabase URL, service role key) — never commit this |
| `.env.example` | Template for `.env` — fill in your own keys |

---

## How It Works

### Task Lifecycle
1. Any member sends a message starting with `#` in the *Tasks* group → bot deletes the raw message, posts a formatted task card with **Start** / **Done** / **📝 Note** buttons. Messages without `#` are ignored (normal chat).
2. **Start** → status becomes "In Progress", card shows who started it and when. **Done** and **📝 Note** buttons remain.
3. **Done** → status becomes "Completed", card shows who completed it and when. All buttons removed.
4. **📝 Note** → bot prompts in group, user types note, bot deletes prompt + message + old card, posts fresh card with note.
5. **❌ Cancel** → owner only. Bot prompts for reason, owner types reason, card updates to show cancelled status with reason. No buttons shown after cancellation.
6. Order enforced: not_started → in_progress → done. No skipping. Cancel is always available (except for done tasks).

### Age Colour Coding
Task cards and `/status` show emoji based on age:
- 🟢 Less than 4 hours
- 🟡 4-24 hours
- 🔴 More than 24 hours

### Active Hours (configurable, default 0:00-23:59)
- **Messages**: bot accepts messages **24/7**, creates tasks anytime.
- **Buttons**: configurable — can lock buttons for employees outside active hours. Owner can always click.
- **Alert DMs**: no alerts at night. Timers pause outside active hours.

### No-Response Alerts (Owner)
- If a task stays "not_started" for **2 hours** during active hours, bot DMs the owner personally.
- Repeats every **2 hours** until the task is started.
- Alerts **pause outside active hours** and resume.

### Doer Reminder
- If someone starts a task but doesn't finish in **3 hours**, bot DMs that person directly: "You started this task 3h ago, is it done?"
- Repeats every **4 hours** until the task is completed.
- Respects active hours (no pinging at night).

### EOD Summary
- DMs the owner at **7:30 PM**.
- Shows tasks completed today vs carried forward.
- Carried tasks get `carry_count` incremented.

### Morning Brief
- DMs the owner at **9:00 AM**.
- Shows all pending tasks (not_started + in_progress) with age and who's handling each.

### Task Notes
- One way only: click **📝 Note** on task card → bot prompts in group → type note → done.
- Bot deletes the prompt + your message + old card → posts fresh card at bottom with note visible.
- 2-minute timeout — if you don't type within 2 minutes, the pending note is cleared.

### Task Search
- `/find keyword` — searches all tasks (case-insensitive).
- Shows matching tasks with status, age, who handled each (last 10 results, most recent first).
- Works in group and private chat.

### Delete
- **Owner**: can delete any task at any time (any status, no time limit). Delete button visible on all task cards.
- **Creator**: can delete a task within **5 minutes** of creation (only if not started yet).
- Removes the task card and the original raw message.

### /status Command
- Anyone can type `/status` to see the current Not Started / In Progress list on demand.
- Shows age emoji (🟢🟡🔴) and who started each task.
- Pinned board has been removed to reduce clutter on small screens.

### Private Chat Rules
- **Owner** (`/start`): registers as owner, receives all alerts and summaries.
- **Team members**: any other DM gets a redirect message.

### Weekly Report
- `/report` — generates CSV report for the current week (Mon-Sun)
- Auto-sent to owner every Monday morning (configurable)
- CSV includes: task detail (ID, description, submitted by, status, dates, cancel reason) + per-person summary (submitted, completed, cancelled counts)

### Cancel Feature
- ❌ Cancel button visible only to owner
- Owner clicks Cancel → prompted for reason → types reason → card updates with cancelled status + reason
- Cancelled tasks remain visible but have no buttons
- Cancel only works for not_started and in_progress tasks (not done tasks)

### Schedule Feature
- 📅 Schedule button visible only to owner, only on `not_started` tasks.
- Owner clicks Schedule → prompted to type a date in group chat.
- Accepts: `tomorrow`, `3 days`, `friday`, `25 december`, `next week`, etc.
- 5-minute timeout — if no date typed, pending schedule is cleared.
- Bot saves task as scheduled, sends owner a DM with ✏️ Edit / ❌ Cancel buttons.
- Bot checks every **30 minutes** and activates due tasks — posts task card in group, starts alert timers.
- On activation, the DM is updated to show "This task is now live in the group!" and buttons are removed.
- Owner can edit the date or cancel the scheduled task from the DM before it goes live.

---

## Data Storage
All state in Supabase, not in-memory:

### `tasks` table
| Column | Type | Purpose |
|---|---|---|
| `id` | BIGSERIAL | Auto-increment task ID |
| `text` | TEXT | Task description |
| `submitted_by` | BIGINT | Telegram user ID of submitter |
| `submitted_by_name` | TEXT | Display name of submitter |
| `submitted_at` | TIMESTAMPTZ | When task was created |
| `status` | TEXT | not_started / in_progress / done / cancelled |
| `started_by` | BIGINT | Who clicked Start |
| `started_by_name` | TEXT | Display name of starter |
| `started_at` | TIMESTAMPTZ | When Start was clicked |
| `done_by` | BIGINT | Who clicked Done |
| `done_by_name` | TEXT | Display name of completer |
| `done_at` | TIMESTAMPTZ | When Done was clicked |
| `carried_forward` | BOOLEAN | True if carried past EOD |
| `carry_count` | INTEGER | Times carried forward |
| `last_alerted_at` | TIMESTAMPTZ | Last alert sent to owner |
| `message_id` | BIGINT | Telegram message ID of task card |
| `source_message_id` | BIGINT | Original user message (deleted by bot) |
| `chat_id` | BIGINT | Group chat ID |
| `cancel_reason` | TEXT | Reason for cancellation |
| `cancelled_by` | BIGINT | Who clicked Cancel |
| `cancelled_by_name` | TEXT | Display name of canceller |
| `cancelled_at` | TIMESTAMPTZ | When Cancel was clicked |
| `is_scheduled` | BOOLEAN | True if task is scheduled for future |
| `scheduled_for` | TIMESTAMPTZ | When task should go live |

### `notes` table
| Column | Type | Purpose |
|---|---|---|
| `id` | BIGSERIAL | Auto-increment note ID |
| `task_id` | BIGINT | References tasks(id) ON DELETE CASCADE |
| `author_id` | BIGINT | Telegram user ID of note author |
| `author_name` | TEXT | Display name of author |
| `text` | TEXT | Note content |
| `created_at` | TIMESTAMPTZ | When note was created |

### `bot_state` table
Stores `group_chat_id` and `owner_user_id` across restarts.

### `scheduled_dm` table
| Column | Type | Purpose |
|---|---|---|
| `id` | BIGSERIAL | Auto-increment note ID |
| `task_id` | BIGINT | References tasks(id) ON DELETE CASCADE |
| `chat_id` | BIGINT | Owner's Telegram user ID (DM chat) |
| `message_id` | BIGINT | Telegram message ID of the schedule DM |

---

## Supabase Setup
- Create a free Supabase project at [supabase.com](https://supabase.com).
- Free plan is sufficient — 500 MB database, 5 GB egress.
- RLS enabled; only the service_role key accesses data.
- Run the SQL from the Supabase SQL Editor to create required tables.

---

## Hosting
- Runs on Node.js on Windows.
- `node index.js` to start.
- Bot runs 24/7; active hours control when buttons work and alerts fire.
- Timezone: set `TZ=Your/Timezone` environment variable before running (e.g., `TZ=Asia/Kolkata`, `TZ=America/New_York`).

---

## Admin Rights Required
The bot needs these admin rights in the *Tasks* group:
- **Delete Messages** (to remove raw user messages)
- **Send Messages** (to post task cards and alerts)

---

## Config (Owner-Adjustable)
Edit `config.js` — no code changes needed:

| Setting | Default | What It Does |
|---|---|---|
| `ACTIVE_START_HOUR` | 0 | When active hours start |
| `ACTIVE_START_MINUTE` | 0 | Minute active hours start |
| `ACTIVE_END_HOUR` | 20 | When active hours end (buttons lock for employees) |
| `ACTIVE_END_MINUTE` | 0 | Minute active hours end |
| `EOD_SUMMARY_HOUR` | 19 | Daily summary time |
| `EOD_SUMMARY_MINUTE` | 30 | |
| `MORNING_BRIEF_HOUR` | 9 | Morning pending brief time |
| `MORNING_BRIEF_MINUTE` | 0 | |
| `OVERDUE_HOURS` | 4 | Flag on board after this |
| `ALERT_AFTER_HOURS` | 2 | DM owner after this (not_started tasks) |
| `ALERT_REPEAT_HOURS` | 2 | Repeat owner alert interval |
| `DOER_REMIND_AFTER_HOURS` | 3 | DM doer after this (in_progress tasks) |
| `DOER_REMIND_REPEAT_HOURS` | 4 | Repeat doer reminder interval |
| `MAX_TASK_TEXT_LENGTH` | 80 | Truncate task text on /status |
| `WEEKLY_REPORT_DAY` | 1 | Day of week for auto report (0=Sun, 1=Mon, ... 6=Sat) |
| `WEEKLY_REPORT_HOUR` | 9 | Hour to send weekly report |
| `WEEKLY_REPORT_MINUTE` | 0 | Minute to send weekly report |
| `LANGUAGE` | english | 'english' or 'hinglish' |

After editing, restart: `node index.js`

---

## Adding Team Members
Just add them to the *Tasks* group. Anyone who posts in the group is automatically allowed. No code changes needed.

---

## Owner Registration
Owner must send `/start` to the bot in **private chat** once. This sets `OWNER_USER_ID` for DM alerts and button override.

---

## EOD and Carry-Forward
- At 7:30 PM, bot DMs owner a summary: done today vs carried forward.
- Any task not "done" by EOD gets `carried_forward = true` and `carry_count += 1`.
- Carried tasks retain their original `submitted_at` — age keeps growing, never resets.

---

## Restart Behavior
All timers re-schedule from DB on bot restart:
- Owner alerts (not_started tasks)
- Doer reminders (in_progress tasks)
- EOD and morning brief schedules

---

## Troubleshooting
| Problem | Fix |
|---|---|
| Bot not responding | Check console output for errors |
| Buttons locked at night | Normal — owner can still click |
| Raw messages not deleted | Enable "Delete Messages" admin right for bot |
| Alerts not arriving | Owner must `/start` the bot in private chat |
| Supabase connection failed | Check `.env` keys match your Supabase project |
| Task name shows as user ID | Run the SQL migration (adds `submitted_by_name` column) |
| Notes not saving | Create the `notes` table in Supabase SQL Editor |
