// Config — All owner-adjustable settings in one place.
// Edit values below to change timings, language, timezone. No code changes needed.
export const CONFIG = {
  // Bot active window (24-hour format)
  // Bot starts processing at this time each day
  ACTIVE_START_HOUR: 0,
  ACTIVE_START_MINUTE: 0,
  // Bot exits after this time (should be after EOD_SUMMARY_HOUR)
  ACTIVE_END_HOUR: 20,
  ACTIVE_END_MINUTE: 0,

  // End-of-day summary time (24-hour format)
  EOD_SUMMARY_HOUR: 19,
  EOD_SUMMARY_MINUTE: 30,

  // Morning pending brief time (24-hour format)
  MORNING_BRIEF_HOUR: 9,
  MORNING_BRIEF_MINUTE: 0,

  // Overdue flag on pinned board (hours after creation)
  OVERDUE_HOURS: 4,

  // No-response alert settings
  ALERT_AFTER_HOURS: 2,      // Send alert DM to owner after this many hours
  ALERT_REPEAT_HOURS: 2,     // Repeat alert every this many hours until started

  // Doer reminder settings (reminds person who started the task)
  DOER_REMIND_AFTER_HOURS: 3,  // DM doer this many hours after starting
  DOER_REMIND_REPEAT_HOURS: 4, // Repeat every N hours until done

  // Pinned message settings
  MAX_TASK_TEXT_LENGTH: 80,  // Truncate task text on pinned board

  // Weekly report schedule (24-hour format)
  WEEKLY_REPORT_DAY: 1,      // 0=Sun, 1=Mon, ... 6=Sat
  WEEKLY_REPORT_HOUR: 9,
  WEEKLY_REPORT_MINUTE: 0,

  // Language for bot's own text (buttons, labels, summary)
  LANGUAGE: 'english',      // 'english' or 'hinglish'

  // Timezone for date/time display (use IANA format)
  // Examples: 'Asia/Kolkata', 'America/New_York', 'Europe/London'
  TIMEZONE: 'Asia/Kolkata',
};

// Language strings
export const LANG = {
  english: {
    startBtn: 'Start',
    doneBtn: 'Done',
    notStarted: 'Not Started',
    inProgress: 'In Progress',
    overdue: '⚠ OVERDUE',
    pendingTitle: '📋 Pending Tasks',
    notStartedTitle: '🔴 Not Started',
    inProgressTitle: '🟡 In Progress',
    eodTitle: '📊 End of Day Summary',
    doneToday: '✅ Completed Today:',
    carried: '⏭ Carried Forward:',
    noTasks: 'No tasks.',
    taskAge: 'Age:',
    hours: 'h',
    minutes: 'm',
    alertOwner: '⚠ Task pending for {hours}h:\n"{text}"\nSubmitted by: {name}\nTime: {time}',
    alertBoard: '⚠',
    morningBriefTitle: '🌅 Morning Pending Tasks',
    noteBtn: '📝 Note',
    waitingForNote: '📝 Type your note for this task:',
    noteAdded: '✅ Note added!',
    doerReminder: '⏰ You started this task {hours}h ago:\n"{text}"\n\nIs it done? Tap Done in the group when finished.',
    findTitle: '🔍 Search results for "{keyword}":',
    findNoResults: 'No tasks found matching that keyword.',
    findUsage: 'Usage: /find keyword',
    cancelBtn: '❌ Cancel',
    cancelAskReason: '❌ Enter cancel reason:',
    cancelled: '❌ Cancelled',
    reportTitle: '📊 Weekly Report',
  },
  hinglish: {
    startBtn: 'शुरू',
    doneBtn: 'हो गया',
    notStarted: 'शुरू नहीं हुआ',
    inProgress: 'चल रहा है',
    overdue: '⚠ देर हो रही',
    pendingTitle: '📋 बाकी काम',
    notStartedTitle: '🔴 शुरू नहीं हुए',
    inProgressTitle: '🟡 चल रहे',
    eodTitle: '📊 दिन का हाल',
    doneToday: '✅ आज पूरे हुए:',
    carried: '⏭ आगे बढ़े:',
    noTasks: 'कोई काम नहीं।',
    taskAge: 'समय:',
    hours: 'घंटे',
    minutes: 'मिनट',
    alertOwner: '⚠ {hours} घंटे से काम अटका है:\n"{text}"\nद्वारा: {name}\nसमय: {time}',
    alertBoard: '⚠',
    morningBriefTitle: '🌅 आज के बाकी काम',
    noteBtn: '📝 नोट',
    waitingForNote: '📝 इस काम के लिए नोट लिखो:',
    noteAdded: '✅ नोट जुड़ गया!',
    doerReminder: '⏰ तुमने ये काम {hours} घंटे पहले शुरू किया था:\n"{text}"\n\nहो गया? जब पूरा हो जाए तो Done दबाओ।',
    findTitle: '🔍 "{keyword}" के नतीजे:',
    findNoResults: 'उस नाम से कोई काम नहीं मिला।',
    findUsage: 'इस्तेमाल: /find शब्द',
    cancelBtn: '❌ रद्द',
    cancelAskReason: '❌ रद्द करने की वजह लिखो:',
    cancelled: '❌ रद्द',
    reportTitle: '📊 हफ्ते का हिसाब',
  },
};

export function getLang() {
  return LANG[CONFIG.LANGUAGE] || LANG.hinglish;
}