// Package webhooks dispatches activity events to user-configured HTTP
// endpoints. Handlers call Fire() with a small event descriptor; a
// background worker reads from a bounded queue, looks up active
// subscriptions, and POSTs the payload with an HMAC-SHA256 signature in
// X-Webhook-Signature.
//
// Delivery semantics: fire-and-forget with a short retry. Events are
// dropped after 3 failed attempts (status updated on webhooks.last_status_code
// so admins can see health in the API). The HA integration's coordinator
// polling remains the safety net for missed deliveries.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/mbentancour/babytracker/internal/models"
)

// Event is the payload shape we send over the wire. The same shape is stored
// in the dispatch queue.
type Event struct {
	Event     string    `json:"event"`
	Timestamp time.Time `json:"timestamp"`
	Data      any       `json:"data"`
}

// Dispatcher holds the worker goroutine and the outbound queue. Lifetime is
// the lifetime of the process.
type Dispatcher struct {
	db     *sqlx.DB
	ch     chan Event
	client *http.Client
}

var (
	initMu      sync.Mutex
	singleton   *Dispatcher
	deliveryRetries = []time.Duration{1 * time.Second, 5 * time.Second, 25 * time.Second}
)

// Init creates the process-wide dispatcher and starts its worker. Safe to
// call more than once — subsequent calls are no-ops.
func Init(db *sqlx.DB) {
	initMu.Lock()
	defer initMu.Unlock()
	if singleton != nil {
		return
	}
	singleton = &Dispatcher{
		db: db,
		// 256 slots is plenty for a home-scale app; a storm of events would
		// be unusual. Once full we drop (with a log) rather than blocking
		// the HTTP request that's trying to enqueue.
		ch:     make(chan Event, 256),
		client: &http.Client{Timeout: 5 * time.Second},
	}
	go singleton.run()
	slog.Info("webhook dispatcher started")
}

// Fire enqueues an event for delivery. Returns without error even if the
// dispatcher isn't initialised (useful for tests / the import CLI where the
// dispatcher is deliberately absent) or if the queue is full. Callers don't
// care about delivery success — the DB row is already written.
func Fire(event string, data any) {
	if singleton == nil {
		return
	}
	evt := Event{Event: event, Timestamp: time.Now().UTC(), Data: data}
	select {
	case singleton.ch <- evt:
	default:
		slog.Warn("webhook queue full, dropping event", "event", event)
	}
}

func (d *Dispatcher) run() {
	for evt := range d.ch {
		d.dispatch(evt)
	}
}

// dispatch looks up active webhooks matching the event type and POSTs to
// each one concurrently. Returns when all attempts have settled.
func (d *Dispatcher) dispatch(evt Event) {
	subs, err := models.GetActiveWebhooksForEvent(d.db, evt.Event)
	if err != nil {
		slog.Error("webhook lookup failed", "error", err, "event", evt.Event)
		return
	}
	if len(subs) == 0 {
		return
	}

	body, err := json.Marshal(evt)
	if err != nil {
		slog.Error("webhook marshal failed", "error", err)
		return
	}

	var wg sync.WaitGroup
	for i := range subs {
		sub := subs[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.deliver(sub, body, evt.Event)
		}()
	}
	wg.Wait()
}

func (d *Dispatcher) deliver(w models.Webhook, body []byte, eventName string) {
	// Events LIKE '%event%' in the DB query can produce false positives
	// (e.g. "feeding.created" matches "fed"). Filter precisely here.
	if !eventMatches(w.Events, eventName) {
		return
	}

	sig := signBody(w.Secret, body)
	status := 0
	for attempt := 0; attempt < len(deliveryRetries)+1; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		code, err := d.postOnce(ctx, w.URL, body, sig, eventName)
		cancel()
		if err == nil && code >= 200 && code < 300 {
			status = code
			break
		}
		if err != nil {
			slog.Warn("webhook delivery attempt failed", "webhook_id", w.ID, "url", w.URL, "attempt", attempt+1, "error", err)
		} else {
			slog.Warn("webhook delivery non-2xx", "webhook_id", w.ID, "url", w.URL, "attempt", attempt+1, "status", code)
			status = code
		}
		if attempt < len(deliveryRetries) {
			time.Sleep(deliveryRetries[attempt])
		}
	}
	if err := models.UpdateWebhookStatus(d.db, w.ID, status); err != nil {
		slog.Warn("webhook status update failed", "webhook_id", w.ID, "error", err)
	}
}

func (d *Dispatcher) postOnce(ctx context.Context, url string, body []byte, sig, eventName string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Signature", sig)
	req.Header.Set("X-Webhook-Event", eventName)
	req.Header.Set("User-Agent", "BabyTracker-Webhook/1")
	resp, err := d.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	// Drain so connection can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

// eventMatches returns true when the event name is included in the webhook's
// subscription string. "*" means all events; otherwise entries are
// comma-separated exact names (e.g. "feeding.created,sleep.created").
func eventMatches(subscription, eventName string) bool {
	subscription = strings.TrimSpace(subscription)
	if subscription == "" || subscription == "*" {
		return true
	}
	for _, s := range strings.Split(subscription, ",") {
		if strings.TrimSpace(s) == eventName {
			return true
		}
	}
	return false
}

// signBody returns the full header value expected by subscribers —
// "sha256=<hex>". The prefix matches GitHub's convention so handler authors
// recognise the shape.
func signBody(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return fmt.Sprintf("sha256=%s", hex.EncodeToString(mac.Sum(nil)))
}
