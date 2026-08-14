#!/usr/bin/env python3
"""
Runs inside the sandbox container against the read-only /workspace mount.
Does two things, and nothing else: (1) confirms every file looks like
servable static content, and (2) structurally parses index.html. It does
not execute, import, or evaluate anything from /workspace — files are only
opened for reading text and byte-counting.

Prints exactly one JSON line to stdout: {"valid": true} or
{"valid": false, "reason": "..."}. Exit code mirrors that (0/1), but the
caller treats the JSON line as the source of truth, since a nonzero exit
can also mean Docker itself had trouble, not just "the check failed".
"""
import json
import os
import sys
from html.parser import HTMLParser

WORKSPACE = "/workspace"
MAX_FILE_BYTES = 200_000

# What counts as "servable static content" here. Deliberately does not
# include anything that implies a build step or server-side execution
# (no .php, .py, .sh, no extension-less "binaries").
ALLOWED_EXTENSIONS = {
    ".html", ".css", ".js", ".json", ".svg", ".ico", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2",
}

VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


class StructuralHTMLChecker(HTMLParser):
    """
    A structural well-formedness pass on top of Python's stdlib parser.
    html.parser is intentionally lenient (like a browser) and won't raise
    on most malformed input, so "parses without throwing" alone would
    accept almost anything. This adds the one check that's actually
    useful for catching a broken LLM-generated file: tag balance.
    """

    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
        self.saw_start_tag = False

    def handle_starttag(self, tag, attrs):
        self.saw_start_tag = True
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.saw_start_tag = True

    def handle_endtag(self, tag):
        if tag in VOID_ELEMENTS:
            return
        if not self.stack:
            self.errors.append(f"closing tag </{tag}> with no matching open tag")
            return
        if self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            # Browsers auto-close through a mismatch like this; we allow it
            # but still record it, since it usually indicates truncated or
            # reordered output from the model.
            self.errors.append(f"tag mismatch: expected </{self.stack[-1]}>, got </{tag}>")
            while self.stack and self.stack[-1] != tag:
                self.stack.pop()
            if self.stack:
                self.stack.pop()
        else:
            self.errors.append(f"closing tag </{tag}> with no matching open tag")


def fail(reason: str) -> None:
    print(json.dumps({"valid": False, "reason": reason}))
    sys.exit(1)


def succeed() -> None:
    print(json.dumps({"valid": True}))
    sys.exit(0)


def main() -> None:
    if not os.path.isdir(WORKSPACE):
        fail("workspace directory missing")

    collected = []
    for root, _dirs, filenames in os.walk(WORKSPACE):
        for name in filenames:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, WORKSPACE).replace(os.sep, "/")
            # The bind mount is read-only and the paths were already
            # validated before being written to disk on the host side, but
            # this is the last checkpoint before anything is trusted, so it
            # re-checks rather than assuming the mount is exactly what was
            # intended.
            if rel.startswith(".."):
                fail(f"file escapes workspace root: {rel}")
            collected.append((rel, full))

    if not collected:
        fail("no files found in workspace")

    index_html = None
    for rel, full in collected:
        ext = os.path.splitext(rel)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            fail(f"file '{rel}' has a disallowed extension for static content: '{ext or '(none)'}'")

        try:
            size = os.path.getsize(full)
        except OSError as exc:
            fail(f"could not stat '{rel}': {exc}")
        if size > MAX_FILE_BYTES:
            fail(f"file '{rel}' exceeds {MAX_FILE_BYTES} bytes")

        try:
            with open(full, "r", encoding="utf-8") as handle:
                content = handle.read()
        except UnicodeDecodeError:
            fail(f"file '{rel}' is not valid UTF-8 text")
        except OSError as exc:
            fail(f"could not read '{rel}': {exc}")

        if rel == "index.html":
            index_html = content

    if index_html is None:
        fail("index.html not found at workspace root")

    checker = StructuralHTMLChecker()
    try:
        checker.feed(index_html)
        checker.close()
    except Exception as exc:  # noqa: BLE001 - deliberately broad: any parse failure is a validation failure, not a crash
        fail(f"index.html failed to parse: {exc}")

    if not checker.saw_start_tag:
        fail("index.html contains no HTML tags")
    if checker.errors:
        fail("index.html is not well-formed: " + "; ".join(checker.errors[:5]))
    if checker.stack:
        fail("index.html has unclosed tag(s): " + ", ".join(checker.stack))

    succeed()


if __name__ == "__main__":
    main()
