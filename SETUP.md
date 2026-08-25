# Complaints & Working Task Bot — Setup Guide

## 1. Create the Supabase Tables
1. Open your Supabase project in the browser
2. Go to **SQL Editor** → **New query**
3. Create the `tasks` table — run this SQL:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  submitted_by BIGINT,
  submitted_by_name TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'not_started',
  started_by BIGINT,
  started_by_name TEXT,
  started_at TIMESTAMPTZ,
  done_by BIGINT,
  done_by_name TEXT,
  done_at TIMESTAMPTZ,
  carried_forward BOOLEAN DEFAULT false,
  carry_count INTEGER DEFAULT 0,
  last_alerted_at TIMESTAMPTZ,
  message_id BIGINT,
  source_message_id BIGINT,
  chat_id BIGINT,
  cancel_reason TEXT,
  cancelled_by BIGINT,
  cancelled_by_name TEXT,
  cancelled_at TIMESTAMPTZ,
  is_scheduled BOOLEAN DEFAULT false,
  scheduled_for TIMESTAMPTZ
);
```

4. Create the `notes` table — run this SQL:

```sql
CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  author_id BIGINT,
  author_name TEXT,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

5. Create the `bot_state` table — run this SQL:

```sql
CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

6. Create the `scheduled_dm` table — run this SQL:

```sql
CREATE TABLE IF NOT EXISTS scheduled_dm (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  chat_id BIGINT,
  message_id BIGINT
);
```

7. Click **Run** after each — you should see "Success"

## 2. Fill in your `.env` file
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` in a text editor and replace the placeholder values:
   - `TELEGRAM_BOT_TOKEN` = the long code from @BotFather
   - `SUPABASE_URL` = from your project Settings → API (looks like `https://abcxyz.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` = the long `eyJ...` key from Settings → API
3. Save and close

## 3. Test run (one-time manual)
```bash
npm start
```
You should see:
```
🤖 Telegram Task Bot starting...
Config: { active: '9:00-20:00', eod: '19:30', ... }
Bot launched (polling)
```
If you see errors about missing env vars or Supabase connection, fix `.env` first.

## 4. Final Telegram steps (do once after bot is running)
1. **Owner**: Send `/start` to the bot in **private chat** — this sets your OWNER_USER_ID so you get alerts
2. **Group**: Send any test message starting with `#` in the *Tasks* group (e.g. `#test task`) — this creates the first task
3. **Team**: Add your team members to the *Tasks* group. They just type normally with `#` prefix to create tasks.

## 5. Make it auto-run daily

### Option A: PM2 (recommended for production)
```bash
npm install -g pm2
pm2 start index.js --name telegram-task-bot
pm2 save
pm2 startup
```

### Option B: systemd (Linux)
```bash
sudo tee /etc/systemd/system/telegram-task-bot.service > /dev/null <<'EOF'
[Unit]
Description=Telegram Task Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/telegram-task-bot
ExecStart=/usr/bin/node /path/to/telegram-task-bot/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=TZ=Your/Timezone

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now telegram-task-bot
```

---

## How to adjust settings later
Edit `config.js` — change any value, save, then restart the bot.

Key settings:
- `ACTIVE_START_HOUR/MINUTE` — when bot starts accepting tasks
- `ACTIVE_END_HOUR/MINUTE` — when buttons lock for employees
- `EOD_SUMMARY_HOUR/MINUTE` — daily summary time
- `OVERDUE_HOURS` — flag on board
- `ALERT_AFTER_HOURS` / `ALERT_REPEAT_HOURS` — owner DM timing
- `LANGUAGE` — 'english' or 'hinglish'
- `TIMEZONE` — your IANA timezone (e.g. `Asia/Kolkata`, `America/New_York`)

---

## Files overview
```
telegram-task-bot/
├── index.js              # Main bot code
├── config.js             # Owner settings (edit freely)
├── .env                  # Your secrets (fill once, never commit)
├── .env.example          # Template for .env
├── package.json
└── node_modules/
```

---

## Troubleshooting
- **"Missing required env vars"** — Check `.env` has all 3 values, no typos
- **Supabase connection failed** — Verify URL and service_role_key are correct
- **Owner not getting DMs** — Send `/start` to bot in private chat AFTER bot is running
- **Tasks not showing** — Message must start with `#` and be from a group member
