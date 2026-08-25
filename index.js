// Telegram Task Bot — Main entry point
// Handles: message polling, task creation (#prefix), inline buttons, owner alerts,
// doer reminders, EOD/morning summaries, weekly reports, task scheduling, search
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { CONFIG, getLang } from './config.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required env vars. Fill in .env first.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

let GROUP_CHAT_ID = null;
let OWNER_USER_ID = null;
let WHITELIST = new Set();
let pinnedMessageId = null;
let eodTimer = null;
let morningTimer = null;
let weeklyReportTimer = null;
let lastEODDate = null;
let lastMorningDate = null;
let lastWeeklyReportDate = null;
let alertTimers = new Map();
let doerRemindTimers = new Map();
let doerRemindInitials = new Map();
const pendingNotes = new Map();
const pendingNoteTimers = new Map();
const pendingNotePrompts = new Map();
const pendingCancels = new Map();
const pendingCancelTimers = new Map();
const pendingCancelPrompts = new Map();
const pendingSchedules = new Map();
const pendingScheduleTimers = new Map();
const pendingSchedulePrompts = new Map();
const L = getLang();

// ==================== HELPERS ====================

function formatAge(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  return `${minutes}m`;
}

function ageEmoji(ms) {
  const hours = ms / 3600000;
  if (hours < 4) return '🟢';
  if (hours < 24) return '🟡';
  return '🔴';
}

function isOverdue(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs > CONFIG.OVERDUE_HOURS * 3600000;
}

function submitterName(from) {
  return from.first_name + (from.last_name ? ' ' + from.last_name : '');
}

function parseScheduleDate(input) {
  const text = input.toLowerCase().trim();
  const now = new Date();
  
  // "tomorrow" or "tmrw"
  if (text === 'tomorrow' || text === 'tmrw') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // "day after tomorrow" or "dat"
  if (text === 'day after tomorrow' || text === 'dat') {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // "X days" or "X day" or "Xd"
  const daysMatch = text.match(/^(\d+)\s*days?$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // "next week"
  if (text === 'next week') {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // Day names: monday, tuesday, etc.
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = days.indexOf(text);
  if (dayIndex !== -1) {
    const d = new Date(now);
    const currentDay = d.getDay();
    let daysToAdd = dayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // "next monday", "next friday", etc.
  const nextDayMatch = text.match(/^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (nextDayMatch) {
    const targetDay = days.indexOf(nextDayMatch[1]);
    const d = new Date(now);
    const currentDay = d.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  
  // "25 december", "dec 25", "25 dec"
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const dateMonthMatch = text.match(/^(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/);
  if (dateMonthMatch) {
    const day = parseInt(dateMonthMatch[1]);
    let month = monthNames.indexOf(dateMonthMatch[2]);
    if (month === -1) month = monthShort.indexOf(dateMonthMatch[2]);
    if (month !== -1 && day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), month, day, 9, 0, 0, 0);
      if (d <= now) d.setFullYear(d.getFullYear() + 1);
      return d;
    }
  }
  
  const monthDateMatch = text.match(/^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})$/);
  if (monthDateMatch) {
    let month = monthNames.indexOf(monthDateMatch[1]);
    if (month === -1) month = monthShort.indexOf(monthDateMatch[1]);
    const day = parseInt(monthDateMatch[2]);
    if (month !== -1 && day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), month, day, 9, 0, 0, 0);
      if (d <= now) d.setFullYear(d.getFullYear() + 1);
      return d;
    }
  }
  
  return null;
}

// ==================== PERSISTED STATE (bot_state table) ====================

// Single-row JSON format: one row with key='state' holds all data as JSON.
// Legacy format: multiple rows with key/value pairs. We support both for
// safe migration — loadState reads whichever format exists.

async function loadState() {
  // Try new single-row format first
  const { data: consolidated } = await supabase
    .from('bot_state')
    .select('value')
    .eq('key', 'state')
    .maybeSingle();

  if (consolidated?.value) {
    try {
      const s = JSON.parse(consolidated.value);
      pinnedMessageId = s.pinned_message_id ?? null;
      GROUP_CHAT_ID = s.group_chat_id ?? null;
      OWNER_USER_ID = s.owner_user_id ?? null;
      lastEODDate = s.last_eod_date ?? null;
      lastMorningDate = s.last_morning_date ?? null;
      lastWeeklyReportDate = s.last_weekly_report_date ?? null;
      console.log('State loaded (single-row):', { GROUP_CHAT_ID, OWNER_USER_ID, pinnedMessageId, lastEODDate, lastMorningDate, lastWeeklyReportDate });
      return;
    } catch (e) {
      console.error('Failed to parse consolidated state, falling back to legacy:', e.message);
    }
  }

  // Fallback: legacy key-value rows
  const { data: rows } = await supabase.from('bot_state').select('key, value');
  const map = {};
  for (const r of rows || []) map[r.key] = r.value;
  pinnedMessageId = map.pinned_message_id ? Number(map.pinned_message_id) : null;
  GROUP_CHAT_ID = map.group_chat_id ? Number(map.group_chat_id) : null;
  OWNER_USER_ID = map.owner_user_id ? Number(map.owner_user_id) : null;
  lastEODDate = map.last_eod_date || null;
  lastMorningDate = map.last_morning_date || null;
  lastWeeklyReportDate = map.last_weekly_report_date || null;
  console.log('State loaded (legacy):', { GROUP_CHAT_ID, OWNER_USER_ID, pinnedMessageId, lastEODDate, lastMorningDate, lastWeeklyReportDate });

  // Migrate: consolidate legacy rows into single JSON row
  await migrateState();
}

async function migrateState() {
  try {
    const consolidated = {
      group_chat_id: GROUP_CHAT_ID,
      owner_user_id: OWNER_USER_ID,
      pinned_message_id: pinnedMessageId,
      last_eod_date: lastEODDate,
      last_morning_date: lastMorningDate,
      last_weekly_report_date: lastWeeklyReportDate,
    };
    await supabase.from('bot_state').upsert({ key: 'state', value: JSON.stringify(consolidated) });
    // Delete old legacy rows (keep only the new 'state' row)
    await supabase.from('bot_state').delete().neq('key', 'state');
    console.log('State migrated to single-row format');
  } catch (e) {
    console.error('State migration failed (non-critical):', e.message);
  }
}

async function saveState(key, value) {
  // Read current consolidated state, update the key, write back
  const { data } = await supabase
    .from('bot_state')
    .select('value')
    .eq('key', 'state')
    .maybeSingle();

  let state = {};
  if (data?.value) {
    try { state = JSON.parse(data.value); } catch (e) { /* start fresh */ }
  }
  state[key] = value;
  await supabase.from('bot_state').upsert({ key: 'state', value: JSON.stringify(state) });
}

// ==================== PINNED BOARD ====================

function buildPinnedText(tasks) {
  const done = tasks.filter(t => t.status === 'done');
  const notStarted = tasks.filter(t => t.status === 'not_started');
  const inProgress = tasks.filter(t => t.status === 'in_progress');

  let text = `<b>${L.pendingTitle}</b>\n\n`;

  if (done.length === 0 && notStarted.length === 0 && inProgress.length === 0) {
    text += L.noTasks;
    return text;
  }

  if (done.length > 0) {
    text += `<b>${L.doneToday}</b>\n`;
    for (const t of done) {
      const truncated = t.text.length > CONFIG.MAX_TASK_TEXT_LENGTH
        ? t.text.slice(0, CONFIG.MAX_TASK_TEXT_LENGTH) + '…'
        : t.text;
      const doneBy = t.done_by_name || t.done_by;
      text += `✅ ${truncated} — ${doneBy}\n`;
    }
    text += '\n';
  }

  if (inProgress.length > 0) {
    text += `<b>${L.inProgressTitle}</b>\n`;
    for (const t of inProgress) {
      const ageMs = Date.now() - new Date(t.submitted_at).getTime();
      const emoji = ageEmoji(ageMs);
      const age = formatAge(ageMs);
      const overdue = isOverdue(t.submitted_at) ? ` ${L.overdue}` : '';
      const truncated = t.text.length > CONFIG.MAX_TASK_TEXT_LENGTH
        ? t.text.slice(0, CONFIG.MAX_TASK_TEXT_LENGTH) + '…'
        : t.text;
      const startedBy = t.started_by_name || t.started_by;
      text += `${emoji} ${truncated} (${L.taskAge} ${age})${overdue} — ${startedBy}\n`;
    }
    text += '\n';
  }

  if (notStarted.length > 0) {
    text += `<b>${L.notStartedTitle}</b>\n`;
    for (const t of notStarted) {
      const ageMs = Date.now() - new Date(t.submitted_at).getTime();
      const emoji = ageEmoji(ageMs);
      const age = formatAge(ageMs);
      const overdue = isOverdue(t.submitted_at) ? ` ${L.overdue}` : '';
      const truncated = t.text.length > CONFIG.MAX_TASK_TEXT_LENGTH
        ? t.text.slice(0, CONFIG.MAX_TASK_TEXT_LENGTH) + '…'
        : t.text;
      text += `${emoji} ${truncated} (${L.taskAge} ${age})${overdue}\n`;
    }
  }

  return text;
}

async function fetchPendingTasks() {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .in('status', ['not_started', 'in_progress', 'done'])
    .order('submitted_at', { ascending: true });
  return data || [];
}

async function createPinnedBoard() {
  // Pinned board removed — no longer used
  return;
}

async function updatePinnedBoard() {
  // Pinned board removed — use /board command instead
  return;
}

// ==================== TASK NOTIFICATIONS ====================

async function createTaskButtons(task, viewerId = null) {
  const status = task.status;
  const isCreator = viewerId && task.submitted_by === viewerId;
  const isOwner = viewerId && viewerId === OWNER_USER_ID;

  if (status === 'not_started') {
    const buttons = [
      Markup.button.callback(L.startBtn, `start_${task.id}`),
      Markup.button.callback(L.doneBtn, `done_${task.id}`),
      Markup.button.callback(L.noteBtn, `note_${task.id}`),
    ];
    if (isOwner) {
      buttons.push(Markup.button.callback('📅 Schedule', `schedule_${task.id}`));
    }
    if (isOwner) {
      buttons.push(Markup.button.callback('🗑 Delete', `delete_${task.id}`));
    } else {
      const ageMinutes = (Date.now() - new Date(task.submitted_at).getTime()) / 60000;
      if (isCreator && ageMinutes <= 5) {
        buttons.push(Markup.button.callback('🗑 Delete', `delete_${task.id}`));
      }
    }
    if (isOwner) {
      buttons.push(Markup.button.callback(L.cancelBtn, `cancel_${task.id}`));
    }
    return Markup.inlineKeyboard(buttons);
  }
  if (status === 'in_progress') {
    const buttons = [
      Markup.button.callback(L.doneBtn, `done_${task.id}`),
      Markup.button.callback(L.noteBtn, `note_${task.id}`),
    ];
    if (isOwner) {
      buttons.push(Markup.button.callback('🗑 Delete', `delete_${task.id}`));
      buttons.push(Markup.button.callback(L.cancelBtn, `cancel_${task.id}`));
    }
    return Markup.inlineKeyboard(buttons);
  }
  if (status === 'done') {
    return null;
  }
  return null;
}

async function getTaskNotificationText(task) {
  const statusLabel = task.status === 'not_started' ? 'Not Started'
    : task.status === 'in_progress' ? 'In Progress'
    : task.status === 'cancelled' ? L.cancelled
    : 'Completed';

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: CONFIG.TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true }) : '';

  const ageMs = Date.now() - new Date(task.submitted_at).getTime();
  const emoji = ageEmoji(ageMs);

  let text = `${emoji} <b>Task:</b> ${task.text}\n\n`;
  text += `👤 <b>By:</b> ${task.submitted_by_name || task.submitted_by}`;
  text += `  ⏰ ${fmtTime(task.submitted_at)}\n`;
  text += `📌 <b>Status:</b> ${statusLabel}\n`;

  if (task.status === 'cancelled') {
    text += `❌ <b>Reason:</b> ${task.cancel_reason || 'No reason given'}\n`;
    text += `🚫 <b>Cancelled by:</b> ${task.cancelled_by_name || task.cancelled_by}`;
    text += `  ⏰ ${fmtTime(task.cancelled_at)}\n`;
  }

  if (task.status === 'in_progress' || task.status === 'done') {
    text += `🚀 <b>Started:</b> ${task.started_by_name || task.started_by}`;
    text += `  ⏰ ${fmtTime(task.started_at)}\n`;
  }
  if (task.status === 'done') {
    text += `✅ <b>Done:</b> ${task.done_by_name || task.done_by}`;
    text += `  ⏰ ${fmtTime(task.done_at)}\n`;
  }

  const { data: notes } = await supabase
    .from('notes')
    .select('*')
    .eq('task_id', task.id)
    .order('created_at', { ascending: true });

  if (notes && notes.length > 0) {
    text += '\n<b>Notes:</b>\n';
    for (const n of notes) {
      const noteTime = new Date(n.created_at).toLocaleString('en-IN', {
        timeZone: CONFIG.TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true
      });
      text += `  💬 ${n.text} — ${n.author_name || n.author_id} (${noteTime})\n`;
    }
  }

  return text;
}

async function sendTaskNotification(task) {
  if (!GROUP_CHAT_ID) return;
  try {
    const msg = await bot.telegram.sendMessage(GROUP_CHAT_ID, await getTaskNotificationText(task), {
      parse_mode: 'HTML',
      ...await createTaskButtons(task, OWNER_USER_ID),
    });
    await supabase.from('tasks').update({ message_id: msg.message_id }).eq('id', task.id);
  } catch (e) {
    console.error('Failed to send task notification:', e);
  }
}

async function updateTaskNotification(task, viewerId = null) {
  if (!GROUP_CHAT_ID || !task.message_id) return;
  try {
    const buttons = await createTaskButtons(task, viewerId);
    if (buttons) {
      await bot.telegram.editMessageText(GROUP_CHAT_ID, task.message_id, null, await getTaskNotificationText(task), {
        parse_mode: 'HTML',
        ...buttons,
      });
    } else {
      await bot.telegram.editMessageText(GROUP_CHAT_ID, task.message_id, null, await getTaskNotificationText(task), {
        parse_mode: 'HTML',
      });
    }
  } catch (e) {
    console.error('Failed to update task notification:', e);
  }
}

// ==================== OWNER ALERTS ====================

async function sendOwnerAlert(task) {
  if (!OWNER_USER_ID) return;

  // Don't send alerts outside active hours
  if (!isActiveHours()) return;

  // Make sure the task is still not_started before alerting
  const { data: cur } = await supabase.from('tasks').select('status').eq('id', task.id).single();
  if (!cur || cur.status !== 'not_started') {
    clearAlertTimers(task.id);
    return;
  }

  const ageHours = Math.floor((Date.now() - new Date(task.submitted_at).getTime()) / 3600000);
  const text = L.alertOwner
    .replace('{hours}', ageHours)
    .replace('{text}', task.text)
    .replace('{name}', task.submitted_by_name || task.submitted_by)
    .replace('{time}', new Date(task.submitted_at).toLocaleString('en-IN'));

  try {
    await bot.telegram.sendMessage(OWNER_USER_ID, text);
    await supabase.from('tasks').update({ last_alerted_at: new Date().toISOString() }).eq('id', task.id);
    console.log(`Alert sent to owner for task ${task.id}`);
  } catch (e) {
    console.error('Failed to DM owner:', e);
  }
}

function scheduleAlert(task) {
  if (!OWNER_USER_ID || task.status !== 'not_started') return;

  const now = new Date();
  const createdAt = new Date(task.submitted_at).getTime();
  const ageMs = now.getTime() - createdAt;

  // How long until the first alert (in ms)
  const alertDelayMs = Math.max(0, CONFIG.ALERT_AFTER_HOURS * 3600000 - ageMs);

  // Calculate the absolute time when the first alert would fire
  const firstAlertTime = new Date(now.getTime() + alertDelayMs);
  const alertHour = firstAlertTime.getHours();
  const alertMinute = firstAlertTime.getMinutes();
  const alertMinutesOfDay = alertHour * 60 + alertMinute;
  const activeStartMinutes = CONFIG.ACTIVE_START_HOUR * 60 + CONFIG.ACTIVE_START_MINUTE;

  // If the first alert falls outside active hours, delay it to active start
  let finalDelay = alertDelayMs;
  if (alertMinutesOfDay < activeStartMinutes) {
    // Alert would fire before active hours — delay to active start
    const delayToStart = (activeStartMinutes - alertMinutesOfDay) * 60000;
    finalDelay = alertDelayMs + delayToStart;
  } else if (alertMinutesOfDay >= CONFIG.ACTIVE_END_HOUR * 60 + CONFIG.ACTIVE_END_MINUTE) {
    // Alert would fire after active hours — delay to next day's active start
    const delayToEnd = (24 * 60 - alertMinutesOfDay + activeStartMinutes) * 60000;
    finalDelay = alertDelayMs + delayToEnd;
  }

  const initial = setTimeout(() => {
    sendOwnerAlert(task);
    const repeat = setInterval(() => sendOwnerAlert(task), CONFIG.ALERT_REPEAT_HOURS * 3600000);
    alertTimers.set(task.id, repeat);
  }, finalDelay);
  alertTimers.set(`${task.id}_initial`, initial);
}

function clearAlertTimers(taskId) {
  const initial = alertTimers.get(`${taskId}_initial`);
  if (initial) clearTimeout(initial);
  const repeat = alertTimers.get(taskId);
  if (repeat) clearInterval(repeat);
  alertTimers.delete(`${taskId}_initial`);
  alertTimers.delete(taskId);
}

// ==================== DOER REMINDER ====================

async function sendDoerReminder(task) {
  if (!task.started_by) return;

  // Don't send reminders outside active hours
  if (!isActiveHours()) return;

  const { data: cur } = await supabase.from('tasks').select('status').eq('id', task.id).single();
  if (!cur || cur.status !== 'in_progress') {
    clearDoerRemindTimers(task.id);
    return;
  }

  const ageHours = Math.floor((Date.now() - new Date(task.started_at).getTime()) / 3600000);
  const text = L.doerReminder
    .replace('{hours}', ageHours)
    .replace('{text}', task.text);

  try {
    await bot.telegram.sendMessage(task.started_by, text);
    console.log(`Doer reminder sent for task ${task.id}`);
  } catch (e) {
    console.error('Failed to DM doer:', e);
  }
}

function scheduleDoerReminder(task) {
  if (!task.started_by || task.status !== 'in_progress' || !task.started_at) return;

  const now = new Date();
  const startedAt = new Date(task.started_at).getTime();
  const ageMs = now.getTime() - startedAt;
  const delayMs = Math.max(0, CONFIG.DOER_REMIND_AFTER_HOURS * 3600000 - ageMs);

  const firstAlertTime = new Date(now.getTime() + delayMs);
  const alertMinutesOfDay = firstAlertTime.getHours() * 60 + firstAlertTime.getMinutes();
  const activeStartMinutes = CONFIG.ACTIVE_START_HOUR * 60 + CONFIG.ACTIVE_START_MINUTE;

  let finalDelay = delayMs;
  if (alertMinutesOfDay < activeStartMinutes) {
    finalDelay = delayMs + (activeStartMinutes - alertMinutesOfDay) * 60000;
  } else if (alertMinutesOfDay >= CONFIG.ACTIVE_END_HOUR * 60 + CONFIG.ACTIVE_END_MINUTE) {
    finalDelay = delayMs + (24 * 60 - alertMinutesOfDay + activeStartMinutes) * 60000;
  }

  const initial = setTimeout(() => {
    sendDoerReminder(task);
    const repeat = setInterval(() => sendDoerReminder(task), CONFIG.DOER_REMIND_REPEAT_HOURS * 3600000);
    doerRemindTimers.set(task.id, repeat);
  }, finalDelay);
  doerRemindInitials.set(task.id, initial);
}

function clearDoerRemindTimers(taskId) {
  const initial = doerRemindInitials.get(taskId);
  if (initial) clearTimeout(initial);
  const repeat = doerRemindTimers.get(taskId);
  if (repeat) clearInterval(repeat);
  doerRemindInitials.delete(taskId);
  doerRemindTimers.delete(taskId);
}

// ==================== TASK SEARCH ====================

async function handleFindCommand(ctx, keyword) {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .ilike('text', `%${keyword}%`)
    .order('submitted_at', { ascending: false })
    .limit(10);

  const tasks = data || [];

  if (tasks.length === 0) {
    await ctx.reply(L.findNoResults);
    return;
  }

  let text = L.findTitle.replace('{keyword}', keyword) + '\n\n';
  for (const t of tasks) {
    const ageMs = Date.now() - new Date(t.submitted_at).getTime();
    const emoji = ageEmoji(ageMs);
    const age = formatAge(ageMs);
    const status = t.status === 'not_started' ? L.notStarted
      : t.status === 'in_progress' ? L.inProgress
      : '✅ Done';
    const handler = t.started_by_name || t.done_by_name || t.submitted_by_name || '—';
    const truncated = t.text.length > 80 ? t.text.slice(0, 80) + '…' : t.text;
    text += `${emoji} ${truncated}\n   📌 ${status} | ⏰ ${age} | 👤 ${handler}\n\n`;
  }

  await ctx.reply(text);
}

// ==================== WEEKLY REPORT ====================

function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function escapeCSV(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function generateWeeklyReport() {
  const { start, end } = getWeekRange();

  // Fetch all tasks in the week range
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .gte('submitted_at', start.toISOString())
    .lte('submitted_at', end.toISOString())
    .order('submitted_at', { ascending: true });

  // Build CSV rows
  const rows = [];
  rows.push([
    'Task ID', 'Description', 'Submitted By', 'Submitted At',
    'Status', 'Started By', 'Completed By', 'Completed At',
    'Carry Count', 'Cancel Reason', 'Cancelled By'
  ].join(','));

  for (const t of (tasks || [])) {
    const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', {
      timeZone: CONFIG.TIMEZONE, dateStyle: 'medium', timeStyle: 'short'
    }) : '';
    rows.push([
      escapeCSV(t.id),
      escapeCSV(t.text),
      escapeCSV(t.submitted_by_name || t.submitted_by),
      escapeCSV(fmtTime(t.submitted_at)),
      escapeCSV(t.status),
      escapeCSV(t.started_by_name || ''),
      escapeCSV(t.done_by_name || ''),
      escapeCSV(fmtTime(t.done_at)),
      escapeCSV(t.carry_count || 0),
      escapeCSV(t.cancel_reason || ''),
      escapeCSV(t.cancelled_by_name || ''),
    ].join(','));
  }

  // Per-person summary
  rows.push('');
  rows.push('--- Per-Person Summary ---');
  rows.push('Name,Tasks Submitted,Tasks Completed,Tasks Cancelled');

  const memberMap = new Map();
  for (const t of (tasks || [])) {
    const submitter = t.submitted_by_name || 'Unknown';
    if (!memberMap.has(submitter)) {
      memberMap.set(submitter, { submitted: 0, completed: 0, cancelled: 0 });
    }
    memberMap.get(submitter).submitted++;

    if (t.status === 'done' && t.done_by_name) {
      const completer = t.done_by_name;
      if (!memberMap.has(completer)) {
        memberMap.set(completer, { submitted: 0, completed: 0, cancelled: 0 });
      }
      memberMap.get(completer).completed++;
    }

    if (t.status === 'cancelled' && t.cancelled_by_name) {
      const canceller = t.cancelled_by_name;
      if (!memberMap.has(canceller)) {
        memberMap.set(canceller, { submitted: 0, completed: 0, cancelled: 0 });
      }
      memberMap.get(canceller).cancelled++;
    }
  }

  for (const [name, stats] of memberMap) {
    rows.push([escapeCSV(name), stats.submitted, stats.completed, stats.cancelled].join(','));
  }

  const csv = rows.join('\n');
  const weekLabel = `${start.toLocaleDateString('en-IN', { timeZone: CONFIG.TIMEZONE, dateStyle: 'medium' })} - ${end.toLocaleDateString('en-IN', { timeZone: CONFIG.TIMEZONE, dateStyle: 'medium' })}`;
  const filename = `weekly-report-${start.toISOString().slice(0, 10)}.csv`;

  return { csv, filename, weekLabel, taskCount: tasks?.length || 0 };
}

// ==================== EOD SUMMARY ====================

async function runEODSummary() {
  if (!OWNER_USER_ID) {
    console.error('EOD skipped: OWNER_USER_ID not set');
    return;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: doneToday } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'done')
    .gte('done_at', todayStart.toISOString())
    .lte('done_at', todayEnd.toISOString())
    .order('done_at', { ascending: true });

  const { data: carried } = await supabase
    .from('tasks')
    .select('*')
    .in('status', ['not_started', 'in_progress'])
    .order('submitted_at', { ascending: true });

  let text = `<b>${L.eodTitle}</b>\n\n`;

  text += `<b>${L.doneToday}</b>\n`;
  if (doneToday && doneToday.length > 0) {
    for (const t of doneToday) {
      text += `✅ ${t.text} (by ${t.done_by_name || t.done_by})\n`;
    }
  } else {
    text += `${L.noTasks}\n`;
  }

  text += `\n<b>${L.carried}</b>\n`;
  if (carried && carried.length > 0) {
    for (const t of carried) {
      const carryInfo = t.carry_count > 0 ? ` (carried ${t.carry_count}×)` : '';
      text += `⏭ ${t.text}${carryInfo}\n`;
      await supabase.from('tasks')
        .update({ carried_forward: true, carry_count: t.carry_count + 1 })
        .eq('id', t.id);
    }
  } else {
    text += `${L.noTasks}\n`;
  }

  try {
    await bot.telegram.sendMessage(OWNER_USER_ID, text, { parse_mode: 'HTML' });
    lastEODDate = new Date().toISOString().slice(0, 10);
    await saveState('last_eod_date', lastEODDate);
    console.log('EOD summary sent to owner DM');
  } catch (e) {
    console.error('Failed to send EOD summary:', e);
  }
}

// ==================== MORNING BRIEF ====================

async function runMorningBrief() {
  if (!OWNER_USER_ID) {
    console.error('Morning brief skipped: OWNER_USER_ID not set');
    return;
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .in('status', ['not_started', 'in_progress'])
    .order('submitted_at', { ascending: true });

  let text = `<b>${L.morningBriefTitle}</b>\n\n`;

  if (!tasks || tasks.length === 0) {
    text += 'All clear! No pending tasks.\n';
  } else {
    for (const t of tasks) {
      const ageMs = Date.now() - new Date(t.submitted_at).getTime();
      const emoji = ageEmoji(ageMs);
      const age = formatAge(ageMs);
      const truncated = t.text.length > CONFIG.MAX_TASK_TEXT_LENGTH
        ? t.text.slice(0, CONFIG.MAX_TASK_TEXT_LENGTH) + '…'
        : t.text;

      text += `${emoji} ${truncated} — ${L.taskAge} ${age}\n`;
      text += `   Submitted by: ${t.submitted_by_name || t.submitted_by}\n`;

      if (t.status === 'in_progress') {
        text += `   Started by: ${t.started_by_name || t.started_by}\n`;
      }
      text += '\n';
    }
  }

  try {
    await bot.telegram.sendMessage(OWNER_USER_ID, text, { parse_mode: 'HTML' });
    lastMorningDate = new Date().toISOString().slice(0, 10);
    await saveState('last_morning_date', lastMorningDate);
    console.log('Morning brief sent to owner');

    // Reshuffle pending task cards in group — delete old cards and re-post at bottom
    if (GROUP_CHAT_ID && tasks && tasks.length > 0) {
      for (const t of tasks) {
        if (t.message_id) {
          try { await bot.telegram.deleteMessage(GROUP_CHAT_ID, t.message_id); } catch (e) {}
        }
        await sendTaskNotification(t);
      }
      console.log(`Reshuffled ${tasks.length} pending task cards in group`);
    }
  } catch (e) {
    console.error('Failed to send morning brief:', e);
  }
}

// ==================== SCHEDULED TASK ACTIVATION ====================

async function activateScheduledTasks() {
  const now = new Date();
  
  // Find tasks that are scheduled and due
  const { data: dueTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('is_scheduled', true)
    .lte('scheduled_for', now.toISOString());
  
  if (error || !dueTasks || dueTasks.length === 0) return;
  
  for (const task of dueTasks) {
    // Unschedule the task
    await supabase.from('tasks').update({
      is_scheduled: false,
      scheduled_for: null,
    }).eq('id', task.id);
    
    // Post task card in group
    if (GROUP_CHAT_ID) {
      await sendTaskNotification(task);
      scheduleAlert(task);
      console.log(`Activated scheduled task: ${task.id}`);
    }
    
    // Edit DM to remove buttons
    const { data: dmInfo } = await supabase.from('scheduled_dm').select('*').eq('task_id', task.id).single();
    if (dmInfo) {
      try {
        await bot.telegram.editMessageText(dmInfo.chat_id, dmInfo.message_id, null,
          `📅 <b>Task Scheduled</b>\n\n📋 ${task.text}\n\n✅ This task is now live in the group!`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {}
      await supabase.from('scheduled_dm').delete().eq('task_id', task.id);
    }
  }
}

// Check every 30 minutes
setInterval(activateScheduledTasks, 30 * 60 * 1000);

// ==================== WEEKLY REPORT (top-level for startup recovery) ====================

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

async function sendWeeklyReport() {
  if (!OWNER_USER_ID) return;
  try {
    const report = await generateWeeklyReport();
    const buffer = Buffer.from(report.csv, 'utf-8');
    await bot.telegram.sendDocument(OWNER_USER_ID, {
      source: buffer,
      filename: report.filename,
    }, { caption: `${L.reportTitle}\n📅 ${report.weekLabel}\n📋 ${report.taskCount} tasks` });
    lastWeeklyReportDate = new Date().toISOString().slice(0, 10);
    await saveState('last_weekly_report_date', lastWeeklyReportDate);
    console.log('Weekly report sent to owner');
  } catch (e) {
    console.error('Failed to send weekly report:', e);
  }
}

// ==================== SCHEDULING ====================

function isActiveHours() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const cur = h * 60 + m;
  const start = CONFIG.ACTIVE_START_HOUR * 60 + CONFIG.ACTIVE_START_MINUTE;
  const end = CONFIG.ACTIVE_END_HOUR * 60 + CONFIG.ACTIVE_END_MINUTE;
  return cur >= start && cur < end;
}

function scheduleDailyJobs() {
  if (eodTimer) clearTimeout(eodTimer);
  if (morningTimer) clearTimeout(morningTimer);
  if (weeklyReportTimer) clearTimeout(weeklyReportTimer);

  const now = new Date();

  // EOD timer
  const eodDate = new Date();
  eodDate.setHours(CONFIG.EOD_SUMMARY_HOUR, CONFIG.EOD_SUMMARY_MINUTE, 0, 0);
  if (eodDate <= now) eodDate.setDate(eodDate.getDate() + 1);
  const eodDelayMs = eodDate.getTime() - now.getTime();
  console.log(`EOD scheduled for ${eodDate.toLocaleString('en-IN', {timeZone:CONFIG.TIMEZONE})} (${Math.round(eodDelayMs/3600000)}h from now)`);
  eodTimer = setTimeout(() => {
    runEODSummary();
    eodTimer = setInterval(runEODSummary, 24 * 3600000);
  }, eodDelayMs);

  // Morning brief timer
  const morningDate = new Date();
  morningDate.setHours(CONFIG.MORNING_BRIEF_HOUR, CONFIG.MORNING_BRIEF_MINUTE, 0, 0);
  if (morningDate <= now) morningDate.setDate(morningDate.getDate() + 1);
  const morningDelayMs = morningDate.getTime() - now.getTime();
  morningTimer = setTimeout(() => {
    runMorningBrief();
    morningTimer = setInterval(runMorningBrief, 24 * 3600000);
  }, morningDelayMs);

  // Weekly report timer
  const weeklyDate = new Date();
  const targetDay = CONFIG.WEEKLY_REPORT_DAY;
  const currentDay = weeklyDate.getDay();
  let daysUntilTarget = (targetDay - currentDay + 7) % 7;
  if (daysUntilTarget === 0) {
    // Same day — check if time already passed
    const targetMinutes = CONFIG.WEEKLY_REPORT_HOUR * 60 + CONFIG.WEEKLY_REPORT_MINUTE;
    const currentMinutes = weeklyDate.getHours() * 60 + weeklyDate.getMinutes();
    if (currentMinutes >= targetMinutes) daysUntilTarget = 7;
  }
  weeklyDate.setDate(weeklyDate.getDate() + daysUntilTarget);
  weeklyDate.setHours(CONFIG.WEEKLY_REPORT_HOUR, CONFIG.WEEKLY_REPORT_MINUTE, 0, 0);
  const weeklyDelayMs = weeklyDate.getTime() - now.getTime();
  console.log(`Weekly report scheduled for ${weeklyDate.toLocaleString('en-IN', {timeZone:CONFIG.TIMEZONE})} (${Math.round(weeklyDelayMs/3600000/24)}d from now)`);
  weeklyReportTimer = setTimeout(() => {
    sendWeeklyReport();
    weeklyReportTimer = setInterval(sendWeeklyReport, 7 * 24 * 3600000);
  }, weeklyDelayMs);

  console.log(`Scheduled: EOD ${CONFIG.EOD_SUMMARY_HOUR}:${String(CONFIG.EOD_SUMMARY_MINUTE).padStart(2, '0')}, Morning ${CONFIG.MORNING_BRIEF_HOUR}:${String(CONFIG.MORNING_BRIEF_MINUTE).padStart(2, '0')}, Weekly report day=${CONFIG.WEEKLY_REPORT_DAY}`);
}

async function reloadState() {
  await loadState();

  try {
    const { data: pending } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'not_started');
    for (const task of pending || []) {
      scheduleAlert(task);
    }
  } catch (e) {
    console.error('Failed to schedule alerts:', e.message);
  }

  // Re-schedule doer reminders for in_progress tasks
  try {
    const { data: inProgress } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'in_progress');
    for (const task of inProgress || []) {
      scheduleDoerReminder(task);
    }
    console.log(`Re-scheduled ${inProgress?.length || 0} doer reminders`);
  } catch (e) {
    console.error('Failed to schedule doer reminders:', e.message);
  }

  scheduleDailyJobs();

  // ===== STARTUP RECOVERY =====
  // On every restart, check if any scheduled operation was missed while the
  // bot was down, and fire it immediately. Nothing must be lost.
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // 1) EOD summary
  const eodHour = CONFIG.EOD_SUMMARY_HOUR;
  const eodMinute = CONFIG.EOD_SUMMARY_MINUTE;
  if (now.getHours() > eodHour || (now.getHours() === eodHour && now.getMinutes() >= eodMinute)) {
    if (lastEODDate !== todayKey) {
      console.log('Recovery: missed EOD for today, sending now');
      await runEODSummary();
    }
  }

  // 2) Morning brief
  const morningHour = CONFIG.MORNING_BRIEF_HOUR;
  const morningMinute = CONFIG.MORNING_BRIEF_MINUTE;
  if (now.getHours() > morningHour || (now.getHours() === morningHour && now.getMinutes() >= morningMinute)) {
    if (lastMorningDate !== todayKey) {
      console.log('Recovery: missed morning brief for today, sending now');
      await runMorningBrief();
    }
  }

  // 3) Weekly report
  const targetDay = CONFIG.WEEKLY_REPORT_DAY; // 0=Sun,1=Mon...
  const targetMinutes = CONFIG.WEEKLY_REPORT_HOUR * 60 + CONFIG.WEEKLY_REPORT_MINUTE;
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  // Is it the target day or later this week, past the scheduled time?
  const pastTargetDay = currentDay > targetDay;
  const sameDayPastTime = currentDay === targetDay && currentMinutes >= targetMinutes;
  if (pastTargetDay || sameDayPastTime) {
    // Check if we already sent it this week (last report date is in the current week)
    const lastReport = lastWeeklyReportDate ? new Date(lastWeeklyReportDate + 'T00:00:00Z') : null;
    const lastReportWeek = lastReport ? getWeekNumber(lastReport) : -1;
    const thisWeek = getWeekNumber(now);
    if (lastReportWeek !== thisWeek) {
      console.log('Recovery: missed weekly report for this week, sending now');
      await sendWeeklyReport();
    }
  }

  console.log('Startup recovery complete');
}

// ==================== BOT HANDLERS ====================

bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const text = ctx.message.text;

  // Discover group
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    if (!GROUP_CHAT_ID) {
      GROUP_CHAT_ID = chatId;
      await saveState('group_chat_id', GROUP_CHAT_ID);
      console.log('Discovered GROUP_CHAT_ID:', GROUP_CHAT_ID);
    }
  }

  // Owner registers with /start in private chat
  if (ctx.chat.type === 'private' && text === '/start') {
    OWNER_USER_ID = userId;
    await saveState('owner_user_id', OWNER_USER_ID);
    console.log('Discovered OWNER_USER_ID:', OWNER_USER_ID);
    await ctx.reply('✅ You are now the owner. You will receive alerts for pending tasks.');
    return;
  }

  // /find command (private chat)
  if (ctx.chat.type === 'private' && text && text.startsWith('/find ')) {
    const keyword = text.slice(6).trim();
    if (!keyword) {
      await ctx.reply(L.findUsage);
      return;
    }
    await handleFindCommand(ctx, keyword);
    return;
  }

  // /report command (private chat)
  if (ctx.chat.type === 'private' && text === '/report') {
    const report = await generateWeeklyReport();
    const buffer = Buffer.from(report.csv, 'utf-8');
    await ctx.replyWithDocument({
      source: buffer,
      filename: report.filename,
    }, { caption: `${L.reportTitle}\n📅 ${report.weekLabel}\n📋 ${report.taskCount} tasks` });
    return;
  }

  // Handle pending schedule date input (private chat - from DM Edit button)
  if (ctx.chat.type === 'private' && pendingSchedules.has(userId)) {
    const taskId = pendingSchedules.get(userId);
    pendingSchedules.delete(userId);
    if (pendingScheduleTimers.has(userId)) {
      clearTimeout(pendingScheduleTimers.get(userId));
      pendingScheduleTimers.delete(userId);
    }

    if (!text) {
      await ctx.reply('❌ Please send a text date.');
      return;
    }

    const scheduledDate = parseScheduleDate(text.trim());
    if (!scheduledDate) {
      await ctx.reply('❌ Couldn\'t understand that date. Try: tomorrow, 3 days, friday, 25 december');
      return;
    }

    // Update task as scheduled
    const { error: scheduleError } = await supabase.from('tasks').update({
      is_scheduled: true,
      scheduled_for: scheduledDate.toISOString(),
    }).eq('id', taskId);

    if (scheduleError) {
      console.error('Schedule task error:', scheduleError);
      return;
    }

    // Update existing DM
    const { data: existingDm } = await supabase.from('scheduled_dm').select('*').eq('task_id', taskId).single();
    const { data: scheduledTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    
    const fmtDate = scheduledDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CONFIG.TIMEZONE });
    const dmText = `📅 <b>Task Scheduled</b>\n\n📋 ${scheduledTask?.text || 'Task'}\n📆 Goes live: ${fmtDate}\n\nYou can cancel or edit until this date.`;
    const dmButtons = Markup.inlineKeyboard([
      Markup.button.callback('✏️ Edit', `sched_edit_${taskId}`),
      Markup.button.callback('❌ Cancel', `sched_cancel_${taskId}`),
    ]);
    
    if (existingDm) {
      try {
        await bot.telegram.editMessageText(existingDm.chat_id, existingDm.message_id, null, dmText, {
          parse_mode: 'HTML',
          ...dmButtons,
        });
      } catch (e) {
        console.error('Failed to update schedule DM:', e);
      }
    }

    await ctx.reply(`✅ Task rescheduled for ${fmtDate}`);
    return;
  }

  // Block all other private chat messages
  if (ctx.chat.type === 'private') {
    await ctx.reply('ℹ️ Only the owner can register via /start in this chat.');
    return;
  }

  // Only process messages from the designated group
  if (GROUP_CHAT_ID && chatId !== GROUP_CHAT_ID) return;

  // Commands
  if (text && text.startsWith('/')) {
    if (text === '/status') {
      await ctx.reply(buildPinnedText(await fetchPendingTasks()), { parse_mode: 'HTML' });
    }
    if (text.startsWith('/find ')) {
      const keyword = text.slice(6).trim();
      if (!keyword) {
        await ctx.reply(L.findUsage);
      } else {
        await handleFindCommand(ctx, keyword);
      }
    }
    if (text === '/report') {
      const report = await generateWeeklyReport();
      const buffer = Buffer.from(report.csv, 'utf-8');
      await ctx.replyWithDocument({
        source: buffer,
        filename: report.filename,
      }, { caption: `${L.reportTitle}\n📅 ${report.weekLabel}\n📋 ${report.taskCount} tasks` });
    }
    return;
  }

  if (!text) return;

  // Handle pending note input (group chat)
  if (pendingNotes.has(userId)) {
    const taskId = pendingNotes.get(userId);
    pendingNotes.delete(userId);
    if (pendingNoteTimers.has(userId)) {
      clearTimeout(pendingNoteTimers.get(userId));
      pendingNoteTimers.delete(userId);
    }

    const name = submitterName(ctx.from);
    const { error: noteError } = await supabase.from('notes').insert({
      task_id: taskId,
      author_id: userId,
      author_name: name,
      text: text,
    });

    if (noteError) {
      console.error('Insert note error:', noteError);
      return;
    }

    // Delete the bot's prompt message
    if (pendingNotePrompts.has(userId)) {
      try { await bot.telegram.deleteMessage(chatId, pendingNotePrompts.get(userId)); } catch (e) {}
      pendingNotePrompts.delete(userId);
    }

    // Delete user's note message
    try { await bot.telegram.deleteMessage(chatId, ctx.message.message_id); } catch (e) {}

    // Fetch full task, delete old card, repost fresh card
    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (task) {
      if (task.message_id) {
        try { await bot.telegram.deleteMessage(chatId, task.message_id); } catch (e) {}
      }
      await sendTaskNotification(task);
    }
    return;
  }

  // Handle pending cancel reason input (group chat)
  if (pendingCancels.has(userId)) {
    const taskId = pendingCancels.get(userId);
    pendingCancels.delete(userId);
    if (pendingCancelTimers.has(userId)) {
      clearTimeout(pendingCancelTimers.get(userId));
      pendingCancelTimers.delete(userId);
    }

    if (!text) {
      await ctx.reply('❌ Please send a text reason.');
      return;
    }

    const reason = text.trim();

    // Delete the bot's prompt message
    if (pendingCancelPrompts.has(userId)) {
      try { await bot.telegram.deleteMessage(chatId, pendingCancelPrompts.get(userId)); } catch (e) {}
      pendingCancelPrompts.delete(userId);
    }

    // Delete user's reason message
    try { await bot.telegram.deleteMessage(chatId, ctx.message.message_id); } catch (e) {}

    // Update task to cancelled
    const { error: cancelError } = await supabase.from('tasks').update({
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_by: userId,
      cancelled_by_name: submitterName(ctx.from),
      cancelled_at: new Date().toISOString(),
    }).eq('id', taskId);

    if (cancelError) {
      console.error('Cancel task error:', cancelError);
      return;
    }

    clearAlertTimers(taskId);
    clearDoerRemindTimers(taskId);

    // Fetch full task, delete old card, repost fresh card
    const { data: updatedTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (updatedTask) {
      if (updatedTask.message_id) {
        try { await bot.telegram.deleteMessage(chatId, updatedTask.message_id); } catch (e) {}
      }
      await sendTaskNotification(updatedTask);
    }
    return;
  }

  // Handle pending schedule date input (group chat)
  if (pendingSchedules.has(userId)) {
    const taskId = pendingSchedules.get(userId);
    pendingSchedules.delete(userId);
    if (pendingScheduleTimers.has(userId)) {
      clearTimeout(pendingScheduleTimers.get(userId));
      pendingScheduleTimers.delete(userId);
    }

    if (!text) {
      await ctx.reply('❌ Please send a text date.');
      return;
    }

    const scheduledDate = parseScheduleDate(text.trim());
    if (!scheduledDate) {
      await ctx.reply('❌ Couldn\'t understand that date. Try: tomorrow, 3 days, friday, 25 december');
      return;
    }

    // Delete bot's prompt message
    if (pendingSchedulePrompts.has(userId)) {
      try { await bot.telegram.deleteMessage(chatId, pendingSchedulePrompts.get(userId)); } catch (e) {}
      pendingSchedulePrompts.delete(userId);
    }

    // Delete user's date message
    try { await bot.telegram.deleteMessage(chatId, ctx.message.message_id); } catch (e) {}

    // Update task as scheduled
    const { error: scheduleError } = await supabase.from('tasks').update({
      is_scheduled: true,
      scheduled_for: scheduledDate.toISOString(),
    }).eq('id', taskId);

    if (scheduleError) {
      console.error('Schedule task error:', scheduleError);
      return;
    }

    // Delete task card from group
    const { data: scheduledTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (scheduledTask && scheduledTask.message_id) {
      try { await bot.telegram.deleteMessage(chatId, scheduledTask.message_id); } catch (e) {}
    }

    // Check if there's already a DM for this task (editing)
    const { data: existingDm } = await supabase.from('scheduled_dm').select('*').eq('task_id', taskId).single();
    
    const fmtDate = scheduledDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CONFIG.TIMEZONE });
    const dmText = `📅 <b>Task Scheduled</b>\n\n📋 ${scheduledTask?.text || 'Task'}\n📆 Goes live: ${fmtDate}\n\nYou can cancel or edit until this date.`;
    const dmButtons = Markup.inlineKeyboard([
      Markup.button.callback('✏️ Edit', `sched_edit_${taskId}`),
      Markup.button.callback('❌ Cancel', `sched_cancel_${taskId}`),
    ]);
    
    if (existingDm) {
      // Update existing DM
      try {
        await bot.telegram.editMessageText(existingDm.chat_id, existingDm.message_id, null, dmText, {
          parse_mode: 'HTML',
          ...dmButtons,
        });
      } catch (e) {
        console.error('Failed to update schedule DM:', e);
      }
    } else {
      // Send new DM
      try {
        const dmMsg = await bot.telegram.sendMessage(OWNER_USER_ID, dmText, { 
          parse_mode: 'HTML',
          ...dmButtons,
        });
        await supabase.from('scheduled_dm').insert({
          task_id: taskId,
          chat_id: OWNER_USER_ID,
          message_id: dmMsg.message_id,
        });
      } catch (e) {
        console.error('Failed to send schedule DM:', e);
      }
    }

    return;
  }

  // Only create tasks for messages starting with #
  if (!text.startsWith('#')) return;

  const taskText = text.slice(1).trim();
  if (!taskText) return;

  // Whitelist: everyone who posts in this group is allowed
  WHITELIST.add(userId);

  // Create the task (with retry on DNS/network errors)
  const name = submitterName(ctx.from);
  let task = null;
  let taskError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await supabase
      .from('tasks')
      .insert({
        text: taskText,
        submitted_by: userId,
        submitted_by_name: name,
        submitted_at: new Date().toISOString(),
        status: 'not_started',
        chat_id: chatId,
        source_message_id: ctx.message.message_id,
      })
      .select()
      .single();
    if (!result.error) { task = result.data; break; }
    taskError = result.error;
    console.error(`Insert task attempt ${attempt} failed:`, taskError.message);
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
  }

  if (!task) {
    console.error('Insert task failed after 3 attempts:', taskError);
    return;
  }

  // Remove the raw message so only the formatted task card remains (no duplicate)
  try {
    await bot.telegram.deleteMessage(chatId, ctx.message.message_id);
  } catch (e) {
    // Bot needs "Delete Messages" admin right. If missing, the raw message stays.
    console.log('Could not delete source message (enable Delete Messages right):', e.message);
  }

  await sendTaskNotification(task);
  await updatePinnedBoard();
  scheduleAlert(task);

  console.log(`Task created: ${task.id} by ${name}`);
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  // Handle scheduled DM buttons (private chat)
  if (data.startsWith('sched_edit_') || data.startsWith('sched_cancel_')) {
    const [action, taskIdStr] = data.split('_').slice(1);
    const taskId = parseInt(taskIdStr, 10);
    const isOwner = userId === OWNER_USER_ID;

    if (!isOwner) {
      await ctx.answerCbQuery('❌ Only owner can do this');
      return;
    }

    if (data.startsWith('sched_edit_')) {
      pendingSchedules.set(userId, taskId);
      const timer = setTimeout(() => {
        if (pendingSchedules.has(userId) && pendingSchedules.get(userId) === taskId) {
          pendingSchedules.delete(userId);
        }
      }, 5 * 60 * 1000);
      pendingScheduleTimers.set(userId, timer);

      await ctx.answerCbQuery();
      try {
        await ctx.reply(`📅 Type new date for this task:\n\nExamples: tomorrow, 3 days, friday, 25 december`);
      } catch (e) {
        console.error('Failed to send edit prompt:', e);
      }
    } else if (data.startsWith('sched_cancel_')) {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) {
        console.error('Delete scheduled task error:', error);
        await ctx.answerCbQuery('❌ Error deleting');
        return;
      }

      const { data: dmInfo } = await supabase.from('scheduled_dm').select('*').eq('task_id', taskId).single();
      if (dmInfo) {
        try {
          await bot.telegram.editMessageText(dmInfo.chat_id, dmInfo.message_id, null,
            `📅 <b>Task Scheduled</b>\n\n❌ <b>Cancelled</b>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {}
        await supabase.from('scheduled_dm').delete().eq('task_id', taskId);
      }

      await ctx.answerCbQuery('✅ Scheduled task cancelled');
    }
    return;
  }

  if (!GROUP_CHAT_ID || ctx.chat.id !== GROUP_CHAT_ID) {
    await ctx.answerCbQuery('❌ Wrong group');
    return;
  }

  // After 8 PM — only owner can click buttons
  const isOwner = userId === OWNER_USER_ID;
  if (!isOwner && !isActiveHours()) {
    await ctx.answerCbQuery('⏰ Buttons active after 9 AM');
    return;
  }

  const [action, taskIdStr] = data.split('_');
  const taskId = parseInt(taskIdStr, 10);

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    await ctx.answerCbQuery('❌ Task not found');
    return;
  }

  if (action === 'delete') {
    const isCreator = task.submitted_by === userId;
    const isOwner = userId === OWNER_USER_ID;
    if (!isCreator && !isOwner) {
      await ctx.answerCbQuery('❌ Only creator or owner can delete');
      return;
    }
    if (!isOwner) {
      if (task.status !== 'not_started') {
        await ctx.answerCbQuery('❌ Can only delete a task that has not started');
        return;
      }
      const ageMinutes = (Date.now() - new Date(task.submitted_at).getTime()) / 60000;
      if (ageMinutes > 5) {
        await ctx.answerCbQuery('❌ Delete window expired (5 min)');
        return;
      }
    }

    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) {
      console.error('Delete task error:', error);
      await ctx.answerCbQuery('❌ Error deleting');
      return;
    }
    clearAlertTimers(taskId);
    clearDoerRemindTimers(taskId);

    // Delete the bot's task card
    if (task.message_id) {
      try { await bot.telegram.deleteMessage(GROUP_CHAT_ID, task.message_id); } catch (e) { console.error('Del card:', e.message); }
    }
    // Delete the employee's original raw message too
    if (task.source_message_id) {
      try { await bot.telegram.deleteMessage(GROUP_CHAT_ID, task.source_message_id); } catch (e) {}
    }

    await ctx.answerCbQuery('🗑 Deleted');
    await updatePinnedBoard();
    return;
  }

  if (action === 'start') {
    if (task.status !== 'not_started') {
      await ctx.answerCbQuery(`❌ Only "${L.notStarted}" tasks can be started`);
      return;
    }
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'in_progress',
        started_by: userId,
        started_by_name: submitterName(ctx.from),
        started_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    if (error) {
      await ctx.answerCbQuery('❌ Error');
      return;
    }

    clearAlertTimers(taskId);
    await ctx.answerCbQuery('✅ Started');
    await updatePinnedBoard();

    const { data: updatedTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (updatedTask) {
      await updateTaskNotification(updatedTask, userId);
      scheduleDoerReminder(updatedTask);
    }

  } else if (action === 'done') {
    if (task.status !== 'in_progress') {
      await ctx.answerCbQuery(`❌ Only "${L.inProgress}" tasks can be completed`);
      return;
    }
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'done',
        done_by: userId,
        done_by_name: submitterName(ctx.from),
        done_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    if (error) {
      await ctx.answerCbQuery('❌ Error');
      return;
    }

    clearAlertTimers(taskId);
    clearDoerRemindTimers(taskId);
    await ctx.answerCbQuery('✅ Done');
    await updatePinnedBoard();

    const { data: updatedTask } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (updatedTask) await updateTaskNotification(updatedTask, userId);
  } else if (action === 'note') {
    pendingNotes.set(userId, taskId);
    // Auto-clear after 2 minutes
    const timer = setTimeout(() => {
      if (pendingNotes.has(userId) && pendingNotes.get(userId) === taskId) {
        pendingNotes.delete(userId);
      }
    }, 2 * 60 * 1000);
    pendingNoteTimers.set(userId, timer);

    await ctx.answerCbQuery();
    try {
      const promptMsg = await bot.telegram.sendMessage(GROUP_CHAT_ID, `📝 ${submitterName(ctx.from)}, type your note for this task:`, {
        reply_parameters: { message_id: ctx.callbackQuery.message.message_id, force_reply: true },
      });
      pendingNotePrompts.set(userId, promptMsg.message_id);
    } catch (e) {
      console.error('Failed to send note prompt:', e);
    }
  } else if (action === 'cancel') {
    if (!isOwner) {
      await ctx.answerCbQuery('❌ Only owner can cancel');
      return;
    }
    if (task.status === 'done') {
      await ctx.answerCbQuery('❌ Completed tasks cannot be cancelled');
      return;
    }
    if (task.status === 'cancelled') {
      await ctx.answerCbQuery('❌ Already cancelled');
      return;
    }
    pendingCancels.set(userId, taskId);
    const timer = setTimeout(() => {
      if (pendingCancels.has(userId) && pendingCancels.get(userId) === taskId) {
        pendingCancels.delete(userId);
      }
    }, 2 * 60 * 1000);
    pendingCancelTimers.set(userId, timer);

    await ctx.answerCbQuery();
    try {
      const promptMsg = await bot.telegram.sendMessage(GROUP_CHAT_ID, `❌ ${submitterName(ctx.from)}, ${L.cancelAskReason}`, {
        reply_parameters: { message_id: ctx.callbackQuery.message.message_id, force_reply: true },
      });
      pendingCancelPrompts.set(userId, promptMsg.message_id);
    } catch (e) {
      console.error('Failed to send cancel prompt:', e);
    }
  } else if (action === 'schedule') {
    if (!isOwner) {
      await ctx.answerCbQuery('❌ Only owner can schedule');
      return;
    }
    if (task.status !== 'not_started') {
      await ctx.answerCbQuery('❌ Only not started tasks can be scheduled');
      return;
    }
    
    pendingSchedules.set(userId, taskId);
    const timer = setTimeout(() => {
      if (pendingSchedules.has(userId) && pendingSchedules.get(userId) === taskId) {
        pendingSchedules.delete(userId);
      }
    }, 5 * 60 * 1000);
    pendingScheduleTimers.set(userId, timer);
    
    await ctx.answerCbQuery();
    try {
      const promptMsg = await bot.telegram.sendMessage(GROUP_CHAT_ID, `📅 ${submitterName(ctx.from)}, when should this task go live?\n\nType: tomorrow, 3 days, friday, 25 december, etc.`, {
        reply_parameters: { message_id: ctx.callbackQuery.message.message_id, force_reply: true },
      });
      pendingSchedulePrompts.set(userId, promptMsg.message_id);
    } catch (e) {
      console.error('Failed to send schedule prompt:', e);
    }
  } else if (action === 'schedule_pick') {
    if (!isOwner) {
      await ctx.answerCbQuery('❌ Only owner can schedule');
      return;
    }
    
    pendingSchedules.set(userId, taskId);
    const timer = setTimeout(() => {
      if (pendingSchedules.has(userId) && pendingSchedules.get(userId) === taskId) {
        pendingSchedules.delete(userId);
      }
    }, 5 * 60 * 1000);
    pendingScheduleTimers.set(userId, timer);
    
    await ctx.answerCbQuery();
    try {
      const promptMsg = await bot.telegram.sendMessage(GROUP_CHAT_ID, `📅 ${submitterName(ctx.from)}, type the date:\n\nExamples: tomorrow, 3 days, friday, 25 december`, {
        reply_parameters: { message_id: ctx.callbackQuery.message.message_id, force_reply: true },
      });
      pendingSchedulePrompts.set(userId, promptMsg.message_id);
    } catch (e) {
      console.error('Failed to send schedule prompt:', e);
    }
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// ==================== STARTUP ====================

async function start() {
  console.log('🤖 Telegram Task Bot starting...');
  console.log('Config:', {
    active: `${CONFIG.ACTIVE_START_HOUR}:${String(CONFIG.ACTIVE_START_MINUTE).padStart(2, '0')}-${CONFIG.ACTIVE_END_HOUR}:${String(CONFIG.ACTIVE_END_MINUTE).padStart(2, '0')}`,
    eod: `${CONFIG.EOD_SUMMARY_HOUR}:${String(CONFIG.EOD_SUMMARY_MINUTE).padStart(2, '0')}`,
    overdue: `${CONFIG.OVERDUE_HOURS}h`,
    alert: `${CONFIG.ALERT_AFTER_HOURS}h (repeat ${CONFIG.ALERT_REPEAT_HOURS}h)`,
    lang: CONFIG.LANGUAGE,
  });

  await reloadState();
  console.log('State loaded');

  let lastLaunch = 0;
  function launchBot() {
    const now = Date.now();
    if (now - lastLaunch < 10000) return; // prevent rapid restarts
    lastLaunch = now;
    bot.launch();
    console.log('Bot launched (polling)');
  }

  bot.catch((err) => {
    console.error('Bot polling error:', err.message);
    if (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('network') || err.message.includes('ECONNREFUSED')) {
      console.log('Network issue detected, restarting bot in 5 seconds...');
      setTimeout(launchBot, 5000);
    }
  });

  launchBot();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

start().catch(console.error);