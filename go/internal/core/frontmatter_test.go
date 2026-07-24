package core

import (
	"reflect"
	"testing"
)

func TestParseFrontmatterBasic(t *testing.T) {
	fields := ParseFrontmatter("---\nname: alpha\ndescription: Alpha test skill\n---\n\nBody.\n")
	want := map[string]string{"name": "alpha", "description": "Alpha test skill"}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("got %v, want %v", fields, want)
	}
}

func TestParseFrontmatterCRLF(t *testing.T) {
	fields := ParseFrontmatter("---\r\nname: alpha\r\ndescription: Desc\r\n---\r\nBody")
	if fields["name"] != "alpha" || fields["description"] != "Desc" {
		t.Fatalf("got %v", fields)
	}
}

func TestParseFrontmatterQuotes(t *testing.T) {
	fields := ParseFrontmatter("---\nname: \" alpha \"\nversion: '1.2.3'\n---\n")
	if fields["name"] != "alpha" {
		t.Fatalf("double quotes not stripped+trimmed: %q", fields["name"])
	}
	if fields["version"] != "1.2.3" {
		t.Fatalf("single quotes not stripped: %q", fields["version"])
	}
}

func TestParseFrontmatterLoneQuoteValueSkipped(t *testing.T) {
	fields := ParseFrontmatter("---\nname: \"\n---\n")
	if _, ok := fields["name"]; ok {
		t.Fatalf("lone quote value should be dropped, got %v", fields)
	}
}

func TestParseFrontmatterSplitsAtFirstColon(t *testing.T) {
	fields := ParseFrontmatter("---\ntitle: a: b: c\n---\n")
	if fields["title"] != "a: b: c" {
		t.Fatalf("got %q", fields["title"])
	}
}

func TestParseFrontmatterSkipsMalformedLines(t *testing.T) {
	fields := ParseFrontmatter("---\nno colon here\n: novalue-key\nempty:\nname: ok\n---\n")
	want := map[string]string{"name": "ok"}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("got %v, want %v", fields, want)
	}
}

func TestParseFrontmatterMissingBlock(t *testing.T) {
	if fields := ParseFrontmatter("# Just a doc\n"); len(fields) != 0 {
		t.Fatalf("got %v", fields)
	}
	if fields := ParseFrontmatter("---\nname: unterminated\n"); len(fields) != 0 {
		t.Fatalf("unterminated block should not parse, got %v", fields)
	}
	if fields := ParseFrontmatter("\n---\nname: x\n---\n"); len(fields) != 0 {
		t.Fatalf("block must start at content start, got %v", fields)
	}
}

func TestParseFrontmatterEndsAtEOF(t *testing.T) {
	fields := ParseFrontmatter("---\nname: x\n---")
	if fields["name"] != "x" {
		t.Fatalf("got %v", fields)
	}
}

func TestParseFrontmatterDuplicateKeyLastWins(t *testing.T) {
	fields := ParseFrontmatter("---\nname: first\nname: second\n---\n")
	if fields["name"] != "second" {
		t.Fatalf("got %q", fields["name"])
	}
}

func TestParseFrontmatterTrailingSpacesAfterOpener(t *testing.T) {
	fields := ParseFrontmatter("---  \nname: x\n---\n")
	if fields["name"] != "x" {
		t.Fatalf("got %v", fields)
	}
}
