import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui

// Popout: the Today/Tomorrow agenda, and nothing else.
//
// Deliberately not a second tuiboard. A bar panel is for consulting, not for
// managing: browsing boards and columns needs filters, scrolling and a
// keyboard, and does all of it worse than the TUI sitting one keypress away.
// What a bar can answer well is "what do I have to do now", so that is all it
// answers. Everything else lives in tuiboard proper ('o' opens it).
// The Service lives in the BarWidget and arrives via injectPanel(): one poller.
Panel {
  id: root
  moduleName: "nazz.tuiboard"
  manageIpc: false

  property var hostWidget: null
  property var anchorItem: null

  readonly property var tb: hostWidget ? hostWidget.svc : null

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // Each section carries where it starts in the flat list, so a row can work
  // out its own cursor index without the panel walking the tree.
  readonly property var agendaSections: {
    var defs = [
      { label: "● Overdue",  urgent: true,  section: "overdue",  items: tb ? tb.plannerOverdue : [] },
      { label: "● Today",    urgent: false, section: "today",    items: tb ? tb.plannerToday : [] },
      { label: "→ Tomorrow", urgent: false, section: "tomorrow", items: tb ? tb.plannerTomorrow : [] }
    ]
    var off = 0
    for (var i = 0; i < defs.length; i++) {
      defs[i].offset = off
      off += (defs[i].items || []).length
    }
    return defs
  }

  // The same rows in one sequence: what j/k walks through, and what the
  // keyboard actions resolve against.
  readonly property var agendaFlat: {
    var out = []
    var secs = root.agendaSections
    for (var i = 0; i < secs.length; i++) {
      var items = secs[i].items || []
      for (var j = 0; j < items.length; j++) out.push({ item: items[j], section: secs[i].section })
    }
    return out
  }

  // -1 = no cursor: the panel opens with nothing selected, so a stray Enter
  // cannot tick a task the eye never picked. The first j/k lands on row 0.
  property int cursor: -1
  readonly property var cursorEntry:
    (cursor >= 0 && cursor < agendaFlat.length) ? agendaFlat[cursor] : null

  onAgendaFlatChanged: {
    // A refresh can shorten the list under the cursor — after completing the
    // last overdue task, say. Keep it in range instead of pointing past the end.
    if (root.cursor >= root.agendaFlat.length) root.cursor = root.agendaFlat.length - 1
  }

  function moveCursor(delta) {
    var n = root.agendaFlat.length
    if (n === 0) return
    if (root.cursor < 0) { root.cursor = delta > 0 ? 0 : n - 1; return }
    root.cursor = Math.max(0, Math.min(n - 1, root.cursor + delta))
  }

  // Enter / Space, as in the TUI: one key that ticks and unticks.
  function activateCursor() {
    var e = root.cursorEntry
    if (!e || !root.tb) return
    root.tb.toggleDone(e.item.board, e.item.column, e.item.title, e.item.done === true)
  }

  // `m` tomorrow / `t` today, the TUI's own two shortcuts. Moving a row to the
  // day it already sits on would only rewrite the same line, so it is a no-op.
  // Keep the cursor row inside the viewport when j/k walks off the edge:
  // the scrollbar is hidden, so an off-screen selection would be invisible.
  function ensureVisible(top, h) {
    if (top < flick.contentY) {
      flick.contentY = Math.max(0, top)
    } else if (top + h > flick.contentY + flick.height) {
      flick.contentY = Math.min(Math.max(0, flick.contentHeight - flick.height),
                                top + h - flick.height)
    }
  }

  function scheduleCursor(days) {
    var e = root.cursorEntry
    if (!e || !root.tb) return
    if (days === 1 && e.section === "tomorrow") return
    if (days === 0 && e.section === "today") return
    root.tb.deferTask(e.item.board, e.item.column, e.item.title, days)
  }
  readonly property bool agendaEmpty:
    (tb ? tb.plannerOverdue.length + tb.plannerToday.length + tb.plannerTomorrow.length : 0) === 0
  readonly property int agendaCount:
    tb ? tb.plannerToday.length + tb.plannerTomorrow.length : 0
  // Ticked tasks stay in the list, so the header reports progress rather than
  // a bare total that never moves as the day is worked through.
  readonly property int agendaDone: {
    if (!tb) return 0
    var n = 0
    var all = tb.plannerToday.concat(tb.plannerTomorrow)
    for (var i = 0; i < all.length; i++) if (all[i].done === true) n++
    return n
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(420))
    contentHeight: panel.fittedContentHeight(Style.space(520), Style.space(560))

    // Keys mirror the TUI's, restricted to what the panel can actually do:
    // j/k move, Enter/Space toggles done, m/t reschedule, o hands over to
    // tuiboard proper for everything else. Omarchy is driven from the
    // keyboard, so the mouse must not be the only way in.
    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: root.activateCursor()
      onTextKey: function(t) {
        if (!root.tb) return
        if (t === "r" || t === "R") root.tb.refresh()
        else if (t === "o" || t === "O") root.tb.openBoard()
        else if (t === "m" || t === "M") root.scheduleCursor(1)
        else if (t === "t" || t === "T") root.scheduleCursor(0)
        else if (t === "g") root.cursor = root.agendaFlat.length > 0 ? 0 : -1
        else if (t === "G") root.cursor = root.agendaFlat.length - 1
      }
    }

    ColumnLayout {
      anchors.fill: parent
      anchors.margins: Style.space(14)
      spacing: Style.space(9)

      // ── Header ─────────────────────────────────────────────────────
      RowLayout {
        Layout.fillWidth: true
        Text {
          text: "tuiboard"
          font.family: root.fontFamily
          font.pixelSize: Style.space(15)
          font.bold: true
          color: root.foreground
        }
        Item { Layout.fillWidth: true }
        Text {
          text: (root.tb ? root.tb.overdueCount : 0) + " overdue · "
              + root.agendaDone + "/" + root.agendaCount + " done"
          font.family: root.fontFamily
          font.pixelSize: Style.space(11)
          color: root.dim
        }
      }

      Text {
        visible: root.tb && root.tb.actionStatus !== ""
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: root.tb ? root.tb.actionStatus : ""
        font.family: root.fontFamily
        font.pixelSize: Style.space(10)
        color: root.urgent
      }

      Rectangle { Layout.fillWidth: true; height: 1; color: root.dim; opacity: 0.3 }

      // ── Scrollable content ─────────────────────────────────────────
      Flickable {
        id: flick
        Layout.fillWidth: true
        Layout.fillHeight: true
        contentWidth: width
        contentHeight: body.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        // No visible scrollbar: it lands exactly on the → defer targets at the
        // right edge, and a hit that misses by two pixels completes a task
        // instead of postponing it. The Flickable still scrolls by drag and
        // wheel, so nothing is lost but the indicator.
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AlwaysOff }

        Column {
          id: body
          width: flick.width
          spacing: Style.space(8)

          // The Today/Tomorrow agenda, the same one the TUI shows in its left
          // column — same buckets, same ordering.
          Column {
            width: body.width
            spacing: Style.space(10)

            Repeater {
              model: root.agendaSections
              delegate: Column {
                id: section
                required property var modelData
                readonly property bool isTomorrow: String(modelData.label).indexOf("Tomorrow") >= 0
                width: body.width
                spacing: Style.space(3)
                visible: (modelData.items || []).length > 0

                Text {
                  text: modelData.label + "  " + (modelData.items || []).length
                  font.family: root.fontFamily
                  font.pixelSize: Style.space(12)
                  font.bold: true
                  color: modelData.urgent ? root.urgent : root.foreground
                }

                Repeater {
                  model: modelData.items || []
                  // Same trap as the board delegate: a MouseArea anchored inside
                  // a Row makes Qt disable the Row entirely ("Row will not
                  // function"), so the entries are built but never laid out.
                  // The Row goes inside a plain Item, the click target beside it.
                  delegate: Item {
                    id: agendaRow
                    required property var modelData
                    required property int index
                    // Position in the flat list the cursor walks; the section
                    // knows where it starts, the row adds its own offset.
                    readonly property int flatIndex: section.modelData.offset + index
                    readonly property bool isCursor: root.cursor === flatIndex
                    // Today and Tomorrow keep completed tasks — the day's plan
                    // stays a record of the day — so a done row must be legible
                    // as done at a glance, not just after reading it.
                    readonly property bool isDone: modelData.done === true
                    width: body.width
                    opacity: isDone ? 0.5 : 1.0

                    onIsCursorChanged: if (isCursor) root.ensureVisible(
                      agendaRow.mapToItem(body, 0, 0).y, agendaRow.height)

                    // Selection: a filled band plus an accent edge, so the
                    // cursor reads at a glance even on a dimmed done row.
                    Rectangle {
                      anchors.fill: parent
                      anchors.leftMargin: -Style.space(4)
                      anchors.rightMargin: -Style.space(4)
                      z: -1
                      visible: agendaRow.isCursor
                      color: Color.menu.selectedBackground
                      Rectangle {
                        width: Style.space(2)
                        height: parent.height
                        color: Color.accent
                      }
                    }
                    implicitHeight: agendaLine.implicitHeight
                    height: implicitHeight

                    Row {
                      id: agendaLine
                      width: parent.width
                      spacing: Style.space(6)

                    // Fixed-width time column: entries with a time block line
                    // up, the others stay aligned with them.
                    Text {
                      width: Style.space(46)
                      horizontalAlignment: Text.AlignRight
                      text: agendaRow.isDone
                          ? "✓"
                          : (modelData.timeBlock ? String(modelData.timeBlock).split("-")[0] : "·")
                      font.family: root.fontFamily
                      font.pixelSize: Style.space(10)
                      color: agendaRow.isDone ? root.dim
                           : modelData.bucket === "agenda" ? root.foreground : root.dim
                    }

                    Column {
                      width: body.width - Style.space(56) - Style.space(26)
                      spacing: 0

                      // Long titles are cut at the panel edge rather than wrapped:
                      // one task must stay one line, otherwise a single verbose
                      // title pushes the rest of the day off the panel.
                      Text {
                        width: parent.width
                        elide: Text.ElideRight
                        maximumLineCount: 1
                        text: (modelData.bucket === "priority" && !agendaRow.isDone ? "▲ " : "")
                            + modelData.title
                        font.family: root.fontFamily
                        font.pixelSize: Style.space(11)
                        font.strikeout: agendaRow.isDone
                        color: agendaRow.isDone ? root.dim : root.foreground
                      }

                      Text {
                        width: parent.width
                        elide: Text.ElideRight
                        text: modelData.board + " · " + modelData.column
                            + (modelData.assignee ? "  @" + modelData.assignee : "")
                        font.family: root.fontFamily
                        font.pixelSize: Style.space(9)
                        color: root.dim
                      }
                    }
                    }

                    MouseArea {
                      anchors.fill: parent
                      cursorShape: Qt.PointingHandCursor
                      acceptedButtons: Qt.LeftButton
                      // Clicking also moves the cursor: mouse and keyboard
                      // must never disagree about which row is selected.
                      onClicked: {
                        root.cursor = agendaRow.flatIndex
                        if (root.tb) root.tb.toggleDone(
                          agendaRow.modelData.board,
                          agendaRow.modelData.column,
                          agendaRow.modelData.title,
                          agendaRow.isDone)
                      }
                    }

                    // Push to tomorrow. Declared after the row-wide target so it
                    // wins the press, and hidden in the Tomorrow section where
                    // deferring to tomorrow would be a no-op.
                    Text {
                      visible: !section.isTomorrow && !agendaRow.isDone
                      anchors.right: parent.right
                      anchors.rightMargin: Style.space(2)
                      anchors.top: parent.top
                      text: "→"
                      font.family: root.fontFamily
                      font.pixelSize: Style.space(12)
                      color: deferHit.containsMouse ? root.foreground : root.dim

                      MouseArea {
                        id: deferHit
                        anchors.fill: parent
                        // Finger-sized: the glyph itself is far too small to tap.
                        anchors.margins: -Style.space(8)
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        acceptedButtons: Qt.LeftButton
                        onClicked: if (root.tb) root.tb.deferTask(
                          agendaRow.modelData.board,
                          agendaRow.modelData.column,
                          agendaRow.modelData.title)
                      }
                    }
                  }
                }
              }
            }

            Text {
              visible: root.agendaEmpty
              width: body.width
              text: "Nothing due between yesterday and tomorrow."
              font.family: root.fontFamily
              font.pixelSize: Style.space(11)
              color: root.dim
            }
          }

        }
      }

      Text {
        Layout.fillWidth: true
        // Wraps rather than elides: a hint you cannot read is not a hint.
        wrapMode: Text.WordWrap
        text: "j/k move  ⏎ toggle  t today  m tomorrow  o open  r refresh"
        font.family: root.fontFamily
        font.pixelSize: Style.space(10)
        color: root.dim
      }
    }
  }
}
