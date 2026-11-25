package middleware

import "context"

const changeScopeKey contextKey = "change_scope"

// ChangeScope collects, while one write request is being handled, the children
// that request is about. The live-update stream (handlers.LiveHandler) puts
// one on the request and reads it afterwards, so it can wake only the screens
// of people who can see those children. A request that names no child is
// taken to concern everyone.
//
// Nothing has to be added to an endpoint for this: the scope is filled in by
// the checks that already tie a write to its child. The handlers'
// ensureCreatable notes the child a new row is saved under, and ensureWritable
// the child an existing record belongs to.
type ChangeScope struct {
	children []int
}

// WithChangeScope returns ctx carrying a new, empty scope, and that scope.
func WithChangeScope(ctx context.Context) (context.Context, *ChangeScope) {
	scope := &ChangeScope{}
	return context.WithValue(ctx, changeScopeKey, scope), scope
}

// NoteChangedChild records that the request being handled changes something
// of this child's. It does nothing where there is no scope to record it in (a
// read, a handler called directly by a test) or when childID is not an id.
func NoteChangedChild(ctx context.Context, childID int) {
	scope, ok := ctx.Value(changeScopeKey).(*ChangeScope)
	if !ok || childID <= 0 {
		return
	}
	for _, id := range scope.children {
		if id == childID {
			return
		}
	}
	scope.children = append(scope.children, childID)
}

// Children lists the children noted so far, each once.
func (s *ChangeScope) Children() []int {
	return s.children
}
