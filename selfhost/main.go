// Command samvad-sfu is Samvad's self-hosted selective-forwarding unit.
//
// It's the sovereignty exit (ROADMAP Phase 6): anyone who declines to trust Cloudflare
// Realtime can run this instead and point the client's PionTransport at it. The server
// forwards RTP and rewrites headers — it never transcodes, and it cannot read media that
// the clients have end-to-end encrypted with insertable streams.
package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/thelamsalbrotherscompany/samvad/selfhost/internal/sfu"
)

func main() {
	addr := flag.String("addr", ":8088", "listen address")
	stun := flag.String("stun", "stun:stun.cloudflare.com:3478", "comma-separated STUN/TURN urls")
	flag.Parse()

	iceServers := []webrtc.ICEServer{}
	for _, u := range strings.Split(*stun, ",") {
		if u = strings.TrimSpace(u); u != "" {
			iceServers = append(iceServers, webrtc.ICEServer{URLs: []string{u}})
		}
	}

	hub := sfu.NewHub(iceServers)

	upgrader := websocket.Upgrader{
		// Tighten this for a real deployment (allow only your origins).
		CheckOrigin: func(*http.Request) bool { return true },
	}

	mux := http.NewServeMux()

	// One websocket per client; `?room=<id>` selects the room.
	mux.HandleFunc("/sfu", func(w http.ResponseWriter, r *http.Request) {
		room := r.URL.Query().Get("room")
		if room == "" {
			http.Error(w, "missing ?room=", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.Room(room).Serve(conn)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	// A bare test client (not the Samvad UI) for verifying the SFU end-to-end.
	mux.Handle("/", http.FileServer(http.Dir("web")))

	log.Printf("samvad self-hosted SFU on %s (ws: /sfu?room=<id>)", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
