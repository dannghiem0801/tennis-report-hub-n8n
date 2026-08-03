/**
 * Test the parsePointSequence logic used in PointByPointViewer.
 * Verifies all the marker formats from real FlashScore data.
 */

type SeqSegment = { text: string; marker: "BP" | "SP" | "MP" | null };

function parsePointSequence(raw: string): SeqSegment[] {
  if (!raw) return [];
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const MARKER_RE = /\|\s*(BP|B[0-9]*|SP|MP)\s*\|/i;
  return parts.map<SeqSegment>((part) => {
    const m = part.match(MARKER_RE);
    if (!m) return { text: part, marker: null };
    const tag = m[1].toUpperCase();
    const text = part.replace(MARKER_RE, "").trim();
    if (tag === "SP") return { text, marker: "SP" };
    if (tag === "MP") return { text, marker: "MP" };
    return { text, marker: "BP" };
  });
}

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}\n   expected: ${e}\n   actual:   ${a}`);
    process.exitCode = 1;
  }
}

// Real samples from your screenshots:

// SET 1, Game 8 (Shapovalov breaks Gea)
assertEq(
  parsePointSequence("15:0, 30:0, 40:0 |B1|, 40:15 |B1|, 40:30 |B1|"),
  [
    { text: "15:0", marker: null },
    { text: "30:0", marker: null },
    { text: "40:0", marker: "BP" },
    { text: "40:15", marker: "BP" },
    { text: "40:30", marker: "BP" },
  ],
  "SET 1 game 8: three consecutive BP markers (Shapovalov converts on 3rd BP)"
);

// SET 1, Game 9 (set point)
assertEq(
  parsePointSequence("15:0, 15:15, 15:30, 15:40 |SP|, 30:40 |SP|, 40:40, A:40 |SP|"),
  [
    { text: "15:0", marker: null },
    { text: "15:15", marker: null },
    { text: "15:30", marker: null },
    { text: "15:40", marker: "SP" },
    { text: "30:40", marker: "SP" },
    { text: "40:40", marker: null },
    { text: "A:40", marker: "SP" },
  ],
  "SET 1 game 9: multiple SP markers (set point saved before A:40 wins it)"
);

// SET 3, Game 9 (match point)
assertEq(
  parsePointSequence("15:0, 15:15, 30:15, 30:30, 40:30 |MP|, 40:40, A:40 |MP|, 40:40, A:40 |MP|, 40:40, 40:A |BP|"),
  [
    { text: "15:0", marker: null },
    { text: "15:15", marker: null },
    { text: "30:15", marker: null },
    { text: "30:30", marker: null },
    { text: "40:30", marker: "MP" },
    { text: "40:40", marker: null },
    { text: "A:40", marker: "MP" },
    { text: "40:40", marker: null },
    { text: "A:40", marker: "MP" },
    { text: "40:40", marker: null },
    { text: "40:A", marker: "BP" },
  ],
  "SET 3 game 9: match point drama, deuce 3x, then BP on receiver"
);

// Simple hold
assertEq(
  parsePointSequence("15:0, 30:0, 40:0, 40:15"),
  [
    { text: "15:0", marker: null },
    { text: "30:0", marker: null },
    { text: "40:0", marker: null },
    { text: "40:15", marker: null },
  ],
  "Clean 4-point hold: no markers"
);

// Empty
assertEq(parsePointSequence(""), [], "Empty string returns empty array");

// Whitespace handling
assertEq(
  parsePointSequence("15:0,  30:0 , 40:0 |B1|"),
  [
    { text: "15:0", marker: null },
    { text: "30:0", marker: null },
    { text: "40:0", marker: "BP" },
  ],
  "Trims whitespace around each segment"
);

// Lowercase marker
assertEq(
  parsePointSequence("15:0 |b1|, 30:0 |sp|, 40:0 |mp|"),
  [
    { text: "15:0", marker: "BP" },
    { text: "30:0", marker: "SP" },
    { text: "40:0", marker: "MP" },
  ],
  "Case-insensitive marker normalization (b1/sp/mp → BP/SP/MP)"
);

console.log("\nDone.");
