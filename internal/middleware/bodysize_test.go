package middleware

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMaxBodySize(t *testing.T) {
	var readErr error
	handler := MaxBodySize(10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}))

	// Under the limit: reads fine.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("tiny"))
	handler.ServeHTTP(rec, req)
	if readErr != nil {
		t.Fatalf("body under limit failed to read: %v", readErr)
	}

	// Over the limit: the read must fail with MaxBytesError.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("x", 100)))
	handler.ServeHTTP(rec, req)
	var maxErr *http.MaxBytesError
	if !errors.As(readErr, &maxErr) {
		t.Fatalf("want MaxBytesError for oversized body, got %v", readErr)
	}
}
