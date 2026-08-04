package sfu

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// A client connecting to the SFU must immediately receive an OFFER (the SFU is the sole
// offerer), and that offer must advertise both audio and video — the two recvonly
// transceivers the server pre-adds, which is what lets a client publish on the first round.
func TestServerOffersFirstWithAudioAndVideo(t *testing.T) {
	hub := NewHub(nil)
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.Room(r.URL.Query().Get("room")).Serve(conn)
	}))
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/sfu?room=test"
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	var msg websocketMessage
	if err := c.ReadJSON(&msg); err != nil {
		t.Fatalf("read first message: %v", err)
	}
	if msg.Event != "offer" {
		t.Fatalf("first server message: want event %q, got %q", "offer", msg.Event)
	}
	// msg.Data is a JSON-encoded SessionDescription; its SDP carries the m-lines.
	if !strings.Contains(msg.Data, "m=video") {
		t.Errorf("offer has no video m-line:\n%s", msg.Data)
	}
	if !strings.Contains(msg.Data, "m=audio") {
		t.Errorf("offer has no audio m-line:\n%s", msg.Data)
	}
}

// Two clients in the same room are isolated from a client in a different room, and the hub
// hands back the same *Room for the same id (fan-out is per-room).
func TestHubRoomsArePerId(t *testing.T) {
	hub := NewHub(nil)
	a1 := hub.Room("alpha")
	a2 := hub.Room("alpha")
	b := hub.Room("beta")
	if a1 != a2 {
		t.Error("Room(id) should return the same room for the same id")
	}
	if a1 == b {
		t.Error("different room ids must be different rooms")
	}
}
