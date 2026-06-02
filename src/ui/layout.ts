/**
 * Shared dashboard layout constants. Kept in a leaf module so both the
 * Dashboard and the Modal can import them without an import cycle (the modal
 * panel matches the Agenda's width so it can drop into the Agenda's slot).
 */

/** Width (in cells) of the right-hand Agenda panel — and of the modal panel,
 *  which takes the Agenda's slot while a modal is open. */
export const AGENDA_WIDTH = 50;

/** Row height of the bottom Agents strip — enough for ~5 sessions. */
export const AGENTS_HEIGHT = 7;
