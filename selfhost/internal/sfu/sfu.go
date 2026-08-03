// Package sfu is a small selective-forwarding unit built on Pion. Every participant
// uploads their media once; the SFU forwards it to everyone else, so a client's upload
// cost stays flat regardless of room size — the scaling story the mesh can't provide.
//
// It is the self-hosted media path (docs/ARCHITECTURE.md, ROADMAP Phase 6): the honest
// answer for anyone who declines to trust Cloudflare. The SFU forwards RTP and rewrites
// headers, nothing more — it never transcodes, and with insertable-streams E2EE on the
// clients it cannot read the media either (a non-negotiable).
//
// The forwarding logic follows Pion's canonical sfu-ws example, made room-aware and
// concurrency-safe. Signalling is server-offer-only, so there is never glare.
package sfu

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// Hub owns every room. A room is created on first join and addressed by id.
type Hub struct {
	lock       sync.Mutex
	rooms      map[string]*Room
	iceServers []webrtc.ICEServer
}

// NewHub builds a hub whose peer connections use the given ICE servers.
func NewHub(iceServers []webrtc.ICEServer) *Hub {
	return &Hub{rooms: map[string]*Room{}, iceServers: iceServers}
}

// Room returns the room for id, creating it if needed.
func (h *Hub) Room(id string) *Room {
	h.lock.Lock()
	defer h.lock.Unlock()
	r, ok := h.rooms[id]
	if !ok {
		r = newRoom(id, h.iceServers)
		h.rooms[id] = r
	}
	return r
}

// websocketMessage is the signalling envelope between a client and the SFU.
type websocketMessage struct {
	Event string `json:"event"` // "offer" | "answer" | "candidate"
	Data  string `json:"data"`  // JSON-encoded SDP or ICE candidate
}

// threadSafeWriter serialises concurrent writes to one websocket.
type threadSafeWriter struct {
	*websocket.Conn
	sync.Mutex
}

func (t *threadSafeWriter) WriteJSON(v any) error {
	t.Lock()
	defer t.Unlock()
	return t.Conn.WriteJSON(v)
}

type peerConnectionState struct {
	pc *webrtc.PeerConnection
	ws *threadSafeWriter
}

// Room is one meeting: the live peer connections and the tracks being fanned out among
// them.
type Room struct {
	id         string
	iceServers []webrtc.ICEServer

	lock        sync.RWMutex
	peers       []peerConnectionState
	trackLocals map[string]*webrtc.TrackLocalStaticRTP
}

func newRoom(id string, iceServers []webrtc.ICEServer) *Room {
	r := &Room{
		id:          id,
		iceServers:  iceServers,
		trackLocals: map[string]*webrtc.TrackLocalStaticRTP{},
	}
	// Nudge publishers for keyframes so a fresh subscriber renders quickly.
	go func() {
		for range time.Tick(3 * time.Second) {
			r.dispatchKeyFrame()
		}
	}()
	return r
}

// Serve runs the SFU for one client websocket until it closes.
func (r *Room) Serve(unsafeConn *websocket.Conn) {
	ws := &threadSafeWriter{Conn: unsafeConn}
	defer func() { _ = ws.Close() }()

	// A fresh media engine + interceptors per connection (NACK/PLI/TWCC), so RTCP feedback
	// and retransmission work correctly.
	me := &webrtc.MediaEngine{}
	if err := me.RegisterDefaultCodecs(); err != nil {
		log.Println("sfu: register codecs:", err)
		return
	}
	ir := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(me, ir); err != nil {
		log.Println("sfu: register interceptors:", err)
		return
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithInterceptorRegistry(ir))

	pc, err := api.NewPeerConnection(webrtc.Configuration{ICEServers: r.iceServers})
	if err != nil {
		log.Println("sfu: new peer connection:", err)
		return
	}
	defer func() { _ = pc.Close() }()

	// Accept one audio and one video track from this client (camera + mic).
	for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo, webrtc.RTPCodecTypeAudio} {
		if _, err := pc.AddTransceiverFromKind(typ, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			log.Println("sfu: add transceiver:", err)
			return
		}
	}

	r.lock.Lock()
	r.peers = append(r.peers, peerConnectionState{pc, ws})
	r.lock.Unlock()

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candJSON, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		_ = ws.WriteJSON(&websocketMessage{Event: "candidate", Data: string(candJSON)})
	})

	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		switch s {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			_ = pc.Close()
			r.signalPeerConnections()
		default:
		}
	})

	// A published track: register it as a local track others subscribe to, then pump its
	// RTP into that local track so it fans out to every subscriber.
	pc.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		trackLocal := r.addTrack(t)
		if trackLocal == nil {
			return
		}
		defer r.removeTrack(trackLocal)

		buf := make([]byte, 1500)
		for {
			n, _, readErr := t.Read(buf)
			if readErr != nil {
				if errors.Is(readErr, io.EOF) {
					return
				}
				log.Println("sfu: track read:", readErr)
				return
			}
			if _, writeErr := trackLocal.Write(buf[:n]); writeErr != nil {
				return
			}
		}
	})

	r.signalPeerConnections()

	// Client → SFU: answers to our offers, and ICE candidates.
	message := &websocketMessage{}
	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			return
		}
		if err := json.Unmarshal(raw, message); err != nil {
			continue
		}
		switch message.Event {
		case "answer":
			answer := webrtc.SessionDescription{}
			if err := json.Unmarshal([]byte(message.Data), &answer); err != nil {
				continue
			}
			if err := pc.SetRemoteDescription(answer); err != nil {
				log.Println("sfu: set remote description:", err)
			}
		case "candidate":
			candidate := webrtc.ICECandidateInit{}
			if err := json.Unmarshal([]byte(message.Data), &candidate); err != nil {
				continue
			}
			if err := pc.AddICECandidate(candidate); err != nil {
				log.Println("sfu: add ice candidate:", err)
			}
		default:
		}
	}
}

// addTrack registers an incoming remote track as a local track others can subscribe to.
func (r *Room) addTrack(t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP {
	r.lock.Lock()
	defer func() {
		r.lock.Unlock()
		r.signalPeerConnections()
	}()

	trackLocal, err := webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability, t.ID(), t.StreamID())
	if err != nil {
		log.Println("sfu: new local track:", err)
		return nil
	}
	r.trackLocals[t.ID()] = trackLocal
	return trackLocal
}

func (r *Room) removeTrack(t *webrtc.TrackLocalStaticRTP) {
	r.lock.Lock()
	defer func() {
		r.lock.Unlock()
		r.signalPeerConnections()
	}()
	delete(r.trackLocals, t.ID())
}

// signalPeerConnections reconciles every peer's senders with the room's current tracks and
// renegotiates (server-offers) anyone whose set changed. The SFU is the sole offerer, so
// there is never glare. It retries a bounded number of times if a connection isn't stable
// yet, then backs off and lets the keyframe ticker trigger another pass.
func (r *Room) signalPeerConnections() {
	r.lock.Lock()
	defer func() {
		r.lock.Unlock()
		r.dispatchKeyFrame()
	}()

	attemptSync := func() (tryAgain bool) {
		for i := range r.peers {
			if r.peers[i].pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
				r.peers = append(r.peers[:i], r.peers[i+1:]...)
				return true // slice mutated — restart
			}

			// Tracks this peer already sends, plus tracks it publishes (never echo those back).
			existing := map[string]bool{}
			for _, sender := range r.peers[i].pc.GetSenders() {
				if sender.Track() == nil {
					continue
				}
				existing[sender.Track().ID()] = true
				if _, ok := r.trackLocals[sender.Track().ID()]; !ok {
					if err := r.peers[i].pc.RemoveTrack(sender); err != nil {
						return true
					}
				}
			}
			for _, receiver := range r.peers[i].pc.GetReceivers() {
				if receiver.Track() == nil {
					continue
				}
				existing[receiver.Track().ID()] = true
			}

			// Subscribe the peer to any track it isn't yet receiving.
			for id := range r.trackLocals {
				if existing[id] {
					continue
				}
				if _, err := r.peers[i].pc.AddTrack(r.trackLocals[id]); err != nil {
					return true
				}
			}

			offer, err := r.peers[i].pc.CreateOffer(nil)
			if err != nil {
				return true
			}
			if err := r.peers[i].pc.SetLocalDescription(offer); err != nil {
				return true
			}
			offerJSON, err := json.Marshal(offer)
			if err != nil {
				return true
			}
			if err := r.peers[i].ws.WriteJSON(&websocketMessage{Event: "offer", Data: string(offerJSON)}); err != nil {
				return true
			}
		}
		return false
	}

	for attempt := 0; ; attempt++ {
		if attempt == 25 {
			go func() {
				time.Sleep(3 * time.Second)
				r.signalPeerConnections()
			}()
			return
		}
		if !attemptSync() {
			return
		}
	}
}

// dispatchKeyFrame asks each publisher for a keyframe (PLI), so new subscribers render fast.
func (r *Room) dispatchKeyFrame() {
	r.lock.Lock()
	defer r.lock.Unlock()
	for i := range r.peers {
		for _, receiver := range r.peers[i].pc.GetReceivers() {
			if receiver.Track() == nil {
				continue
			}
			_ = r.peers[i].pc.WriteRTCP([]rtcp.Packet{
				&rtcp.PictureLossIndication{MediaSSRC: uint32(receiver.Track().SSRC())},
			})
		}
	}
}
