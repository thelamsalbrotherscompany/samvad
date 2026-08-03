import { RoomDO } from './room'
import { iceServers, type IceEnv } from './ice'

export { RoomDO }

export interface Env extends IceEnv {
  ROOM: DurableObjectNamespace
}

/**
 * The signalling Worker. It routes a WebSocket for `/ws?room=<id>` to that room's Durable
 * Object — one object per room, addressed deterministically by the room id — and serves
 * `/ice` (the STUN/TURN list). No storage, no auth: knowing the room id is the credential
 * (docs/ARCHITECTURE.md §1). Media never touches this Worker; only the handshake does.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room')
      if (!room) return new Response('Missing ?room=', { status: 400 })

      const id = env.ROOM.idFromName(room)
      return env.ROOM.get(id).fetch(request)
    }

    if (url.pathname === '/ice') {
      // Short-lived creds — never cache them at the edge or in the browser.
      return Response.json(
        { iceServers: await iceServers(env) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 })
    }

    return new Response('Samvad signalling', { status: 200 })
  },
}
