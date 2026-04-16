package crypto

import "testing"

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		name    string
		pw      string
		wantErr bool
	}{
		{"7 chars fails", "Abc12!x", true},
		{"8 chars three classes ok", "Abcde12!", false},
		{"8 chars two classes fails", "abcdefgh", true},
		{"all lower fails", "abcdefghijkl", true},
		{"long mixed ok", "CorrectHorseBatteryStaple1", false},
		{"whitespace counts as symbol", "a b c 1A", false},
		{"empty fails", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidatePassword(c.pw)
			if (err != nil) != c.wantErr {
				t.Fatalf("got err=%v, wantErr=%v", err, c.wantErr)
			}
		})
	}
}
