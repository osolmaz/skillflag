from __future__ import annotations

from skillflag.frontmatter import parse_frontmatter


def test_parses_basic_fields():
    content = "---\nname: alpha\ndescription: Alpha test skill\n---\n\nBody.\n"
    assert parse_frontmatter(content) == {
        "name": "alpha",
        "description": "Alpha test skill",
    }


def test_returns_empty_without_frontmatter():
    assert parse_frontmatter("# Just a heading\n") == {}
    assert parse_frontmatter("") == {}
    assert parse_frontmatter("text\n---\nname: x\n---\n") == {}


def test_strips_one_pair_of_matching_quotes():
    content = "---\na: \"quoted value\"\nb: 'single'\nc: \"mismatch'\n---\n"
    fields = parse_frontmatter(content)
    assert fields["a"] == "quoted value"
    assert fields["b"] == "single"
    assert fields["c"] == "\"mismatch'"


def test_strips_quotes_then_trims_again():
    content = '---\nname: "  padded  "\n---\n'
    assert parse_frontmatter(content)["name"] == "padded"


def test_splits_at_first_colon_only():
    content = "---\nurl: https://example.com/x\n---\n"
    assert parse_frontmatter(content)["url"] == "https://example.com/x"


def test_skips_lines_without_colon_or_empty_key_or_value():
    content = "---\nno colon here\n: novalue\nempty:\nname: ok\n---\n"
    assert parse_frontmatter(content) == {"name": "ok"}


def test_supports_crlf():
    content = "---\r\nname: alpha\r\ndescription: d\r\n---\r\nBody"
    assert parse_frontmatter(content) == {"name": "alpha", "description": "d"}


def test_block_may_end_at_eof():
    content = "---\nname: alpha\n---"
    assert parse_frontmatter(content) == {"name": "alpha"}
