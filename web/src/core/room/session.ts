/**
 * A per-tab identity that survives a refresh but is unique to this tab. Backed by
 * sessionStorage: reloading keeps it (so you reconnect as yourself), opening a new tab
 * mints a fresh one (so two tabs are two participants). Nothing here is a *secret* — it
 * just lets a room recognise a returning connection during its grace window.
 */

const SESSION_KEY = 'samvad.session'
const CREATED_KEY = 'samvad.createdRoom'

export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // sessionStorage blocked (private mode, etc.) — a volatile id still works per-load.
    return crypto.randomUUID()
  }
}

/** The one room this tab is allowed to create — persisted so a host refresh keeps it. */
export function getCreatedRoom(): string {
  try {
    return sessionStorage.getItem(CREATED_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setCreatedRoom(id: string): void {
  try {
    if (id) sessionStorage.setItem(CREATED_KEY, id)
    else sessionStorage.removeItem(CREATED_KEY)
  } catch {
    // ignore
  }
}
