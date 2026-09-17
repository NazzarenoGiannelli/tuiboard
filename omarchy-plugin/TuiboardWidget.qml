import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Icon-only widget: uses BarIconButton, which sizes to the bar's standard
// slot (Style.bar.iconSlot / iconCanvas) and therefore lines up exactly with
// the other icon widgets. WidgetButton instead sizes to the label width:
// with no text it collapses and the content overflows.
BarWidget {
  id: root
  moduleName: "nazz.tuiboard"

  readonly property var svc: tb

  // --- Delegates to the loaded panel ---
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }
  readonly property bool popoutSwitchClosing:
    panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  function injectPanel() {
    var t = panelLoader.item
    if (!t) return
    if ("bar" in t) t.bar = root.bar
    if ("settings" in t) t.settings = root.settings
    if ("anchorItem" in t) t.anchorItem = button
    if ("hostWidget" in t) t.hostWidget = root
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Service {
    id: tb
    settings: root.settings
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("TuiboardPanel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    iconComponent: Component {
      Item {
        TuiboardIcon {
          anchors.centerIn: parent
          iconSize: Style.space(13)
          // Monochrome like the native icons: takes the bar foreground, and
          // shifts to the urgent colour when something is overdue. The count
          // lives in the panel, not in the bar.
          tint: tb.overdueCount > 0
            ? (root.bar ? root.bar.urgent : Color.urgent)
            : (root.bar ? root.bar.barForeground : Color.foreground)
        }
      }
    }

    onPressed: function(b) {
      if (b === Qt.RightButton) tb.refresh()
      else if (b === Qt.MiddleButton) tb.openBoard()
      else root.togglePanel()
    }
  }

  IpcHandler {
    target: "nazz.tuiboard"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function refresh(): string { tb.refresh(); return "ok" }
    function count(): string { return String(tb.openCount) }
    function status(): string {
      return "ready=" + tb.ready + " open=" + tb.openCount
           + " overdue=" + tb.overdueCount
           + " err=" + (tb.lastError || "-")
    }
  }
}
