import QtQuick
import QtQuick.Shapes
import qs.Commons

// tuiboard mark: a filled square with the "t" knocked out.
//
// The hole is real: square and letter live in the SAME ShapePath, and
// fillRule OddEvenFill makes the second subpath cancel the first.
// Fully declarative, no runtime compositing — the same technique as
// DropboxIcon.qml, which already runs fine in this bar. (A version using
// Canvas + 'destination-out' sent quickshell into SIGSEGV.)
Item {
  id: root

  property real iconSize: Style.space(13)
  property color tint: "#eaf6ad"

  implicitWidth: iconSize
  implicitHeight: iconSize

  readonly property real s: iconSize
  readonly property real r: Math.max(1, s * 0.18)

  // Geometry of the "t", in fractions of the side.
  readonly property real stemW: s * 0.15
  // The stem is not centred: it sits left, as in a typographic "t".
  readonly property real xl: s * 0.36
  readonly property real xr: xl + stemW
  // Short left arm, long right arm: that is what tells a "t" apart from
  // a symmetric cross.
  readonly property real barL: s * 0.22
  readonly property real barR: s * 0.60
  readonly property real yTop: s * 0.14
  readonly property real yBarTop: s * 0.32
  readonly property real yBarBot: yBarTop + stemW
  readonly property real yBot: s * 0.84
  // Foot: the stem ends with a short stroke to the right.
  readonly property real footR: s * 0.66
  readonly property real yFootTop: yBot - stemW

  Shape {
    anchors.fill: parent
    antialiasing: true
    // MANDATORY: with the default renderer, triangulating this path sends
    // quickshell into SIGSEGV. Confirmed twice.
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      fillColor: root.tint
      strokeColor: "transparent"
      strokeWidth: 0
      fillRule: ShapePath.OddEvenFill

      // 1. rounded-corner square
      startX: root.r; startY: 0
      PathLine { x: root.s - root.r; y: 0 }
      PathQuad { x: root.s; y: root.r; controlX: root.s; controlY: 0 }
      PathLine { x: root.s; y: root.s - root.r }
      PathQuad { x: root.s - root.r; y: root.s; controlX: root.s; controlY: root.s }
      PathLine { x: root.r; y: root.s }
      PathQuad { x: 0; y: root.s - root.r; controlX: 0; controlY: root.s }
      PathLine { x: 0; y: root.r }
      PathQuad { x: root.r; y: 0; controlX: 0; controlY: 0 }

      // 2. the "t", subtracted from the fill
      PathMove { x: root.xl; y: root.yTop }
      PathLine { x: root.xr; y: root.yTop }
      PathLine { x: root.xr; y: root.yBarTop }
      PathLine { x: root.barR; y: root.yBarTop }
      PathLine { x: root.barR; y: root.yBarBot }
      PathLine { x: root.xr; y: root.yBarBot }
      PathLine { x: root.xr; y: root.yFootTop }
      PathLine { x: root.footR; y: root.yFootTop }
      PathLine { x: root.footR; y: root.yBot }
      PathLine { x: root.xl; y: root.yBot }
      PathLine { x: root.xl; y: root.yBarBot }
      PathLine { x: root.barL; y: root.yBarBot }
      PathLine { x: root.barL; y: root.yBarTop }
      PathLine { x: root.xl; y: root.yBarTop }
      PathLine { x: root.xl; y: root.yTop }
    }
  }
}
