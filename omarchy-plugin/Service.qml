import QtQuick
import Quickshell
import Quickshell.Io

// Polls `tuiboard summary` on an interval and exposes its JSON.
// Same shape as the native Tailscale panel, which consumes
// `tailscale status --json`: the parser stays in the external program,
// this side only draws.
Item {
  id: root

  property var settings: ({})

  property bool ready: false
  property bool refreshing: false
  // A refresh asked for while one is already in flight must not be dropped:
  // completing a task during the periodic poll would otherwise leave the row
  // on screen until the next tick, up to refreshIntervalSec later.
  property bool refreshQueued: false
  property string lastError: ""
  property string generatedAt: ""

  property int openCount: 0
  property int doneCount: 0
  property int overdueCount: 0
  property int todayCount: 0
  property var boards: []
  // Today/Tomorrow planner sections, exactly as the TUI builds them.
  property var plannerOverdue: []
  property var plannerToday: []
  property var plannerTomorrow: []

  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 120, 15, 3600)
  readonly property string command: String(setting("command", "tuiboard summary"))
  readonly property string taskCommand: String(setting("taskCommand", "tuiboard task"))
  property string actionStatus: ""
  property bool writing: false
  // Which mutation is in flight, so the exit handler knows whether the sound
  // is warranted: only completing a task earns one, deferring is housekeeping.
  property string pendingAction: ""

  // Empty disables it. Played detached: a missing file or a busy sink must
  // never delay or fail the write that triggered it.
  readonly property string doneSound:
    String(setting("doneSound", "/usr/share/sounds/freedesktop/stereo/complete.oga"))

  function playDoneSound() {
    if (!root.doneSound) return
    var f = JSON.stringify(root.doneSound)
    Quickshell.execDetached(["bash", "-lc",
      "pw-play " + f + " 2>/dev/null || paplay " + f + " 2>/dev/null || true"])
  }

  readonly property string openCommand:
    String(setting("openCommand", "omarchy-launch-tui --app-id=org.omarchy.tuiboard tuiboard"))

  function setting(name, fallback) {
    var v = settings ? settings[name] : undefined
    return v === undefined || v === null ? fallback : v
  }

  function intSetting(name, fallback, min, max) {
    var n = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(n)) n = fallback
    return Math.max(min, Math.min(max, n))
  }

  function refresh() {
    if (summaryProcess.running) { root.refreshQueued = true; return }
    root.refreshing = true
    // The panel renders only the planner, so the per-board "next" lists are
    // dead weight on every poll: asking for none nearly halves the payload.
    summaryProcess.command = ["bash", "-lc", root.command + " --next 0"]
    summaryProcess.running = true
  }

  // Marks done by title, not by index: between a poll and the click the
  // position may have shifted, the title has not. If the file changed
  // elsewhere the command exits 3, and we report that instead of
  // overwriting.
  function markDone(boardName, columnName, title) {
    if (doneProcess.running) return
    root.writing = true
    root.pendingAction = "done"
    root.actionStatus = "…"
    doneProcess.command = ["bash", "-lc",
      root.taskCommand + " done"
      + " --board " + JSON.stringify(String(boardName))
      + " --column " + JSON.stringify(String(columnName))
      + " --match " + JSON.stringify(String(title))]
    doneProcess.running = true
  }

  // Reopen a completed task. Ticking the wrong row, or finding out a task
  // was not finished after all, must be undoable where it happened.
  function markUndone(boardName, columnName, title) {
    if (doneProcess.running) return
    root.writing = true
    root.pendingAction = "undone"
    root.actionStatus = "…"
    doneProcess.command = ["bash", "-lc",
      root.taskCommand + " undone"
      + " --board " + JSON.stringify(String(boardName))
      + " --column " + JSON.stringify(String(columnName))
      + " --match " + JSON.stringify(String(title))]
    doneProcess.running = true
  }

  // What Enter does in the TUI: one key that ticks and unticks, so the same
  // gesture undoes itself.
  function toggleDone(boardName, columnName, title, isDone) {
    if (isDone) root.markUndone(boardName, columnName, title)
    else root.markDone(boardName, columnName, title)
  }

  // Push a task to another day without leaving the bar. Anything more
  // elaborate than "not today" belongs in the TUI, where you can see the
  // whole board. days defaults to 1 — tomorrow; 0 pulls it back to today.
  function deferTask(boardName, columnName, title, days) {
    if (doneProcess.running) return
    var n = (days === undefined || days === null) ? 1 : parseInt(days, 10)
    if (!isFinite(n)) n = 1
    root.writing = true
    root.pendingAction = "defer"
    root.actionStatus = "…"
    doneProcess.command = ["bash", "-lc",
      root.taskCommand + " defer"
      + " --days " + n
      + " --board " + JSON.stringify(String(boardName))
      + " --column " + JSON.stringify(String(columnName))
      + " --match " + JSON.stringify(String(title))]
    doneProcess.running = true
  }

  function openBoard() {
    Quickshell.execDetached(["bash", "-lc", root.openCommand])
  }

  function applySummary(text) {
    try {
      var data = JSON.parse(text)
      var t = data.totals || {}
      root.openCount = t.open || 0
      root.doneCount = t.done || 0
      root.overdueCount = t.overdue || 0
      root.todayCount = t.today || 0
      root.boards = data.boards || []
      var pl = data.planner || {}
      root.plannerOverdue = pl.overdue || []
      root.plannerToday = pl.today || []
      root.plannerTomorrow = pl.tomorrow || []
      root.generatedAt = String(data.generatedAt || "")
      root.lastError = ""
      root.ready = true
    } catch (e) {
      // Unreadable JSON must not wipe out the good numbers already shown:
      // slightly stale data beats a widget flashing to zero.
      root.lastError = "Unparsable output: " + String(e)
    }
  }

  function elide(s) {
    var t = String(s || "").trim().split("\n")[0]
    return t.length > 120 ? t.slice(0, 117) + "…" : t
  }

  Process {
    id: summaryProcess
    running: false
    command: []
    stdout: StdioCollector { id: outCollector; waitForEnd: true }
    stderr: StdioCollector { id: errCollector; waitForEnd: true }
    onExited: function(exitCode) {
      root.refreshing = false
      if (exitCode === 0) root.applySummary(String(outCollector.text || ""))
      else root.lastError = root.elide(errCollector.text || outCollector.text || "tuiboard summary unavailable")
      if (root.refreshQueued) { root.refreshQueued = false; root.refresh() }
    }
  }

  Process {
    id: doneProcess
    running: false
    command: []
    stdout: StdioCollector { id: doneOut; waitForEnd: true }
    stderr: StdioCollector { id: doneErr; waitForEnd: true }
    onExited: function(exitCode) {
      root.writing = false
      var was = root.pendingAction
      root.pendingAction = ""
      if (exitCode === 0) {
        root.actionStatus = ""
        if (was === "done") root.playDoneSound()
        root.refresh()
      } else if (exitCode === 3) {
        root.actionStatus = "Board changed elsewhere — refresh and retry"
      } else {
        root.actionStatus = root.elide(doneErr.text || doneOut.text || "write failed")
      }
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
