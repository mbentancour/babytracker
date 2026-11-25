package middleware

import (
	"context"
	"reflect"
	"testing"
)

func TestChangeScopeCollectsEachChildOnce(t *testing.T) {
	ctx, scope := WithChangeScope(context.Background())
	for _, id := range []int{4, 0, -2, 9, 4} {
		NoteChangedChild(ctx, id)
	}
	if got := scope.Children(); !reflect.DeepEqual(got, []int{4, 9}) {
		t.Fatalf("children = %v, want [4 9]", got)
	}
}

// Code that notes a child cannot know whether anyone is collecting: a read
// has no scope, nor has a handler a test calls directly.
func TestNoteChangedChildWithoutAScope(t *testing.T) {
	NoteChangedChild(context.Background(), 4)
}
