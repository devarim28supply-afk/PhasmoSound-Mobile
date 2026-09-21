// Generates app/models/labels.json from the desktop overlay's Classifier.cs, so the phone
// names sounds exactly the same way the PC overlay does and the two can never drift apart.
//
//   node tools/extract-labels.js [path to Classifier.cs]
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || "D:/Tools/phasmo-sound-overlay/PhasmoSound/Classifier.cs";
const src = fs.readFileSync(SRC, "utf8");

function section(startNeedle, endNeedle) {
  const a = src.indexOf(startNeedle);
  if (a < 0) throw new Error("not found in Classifier.cs: " + startNeedle);
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  return src.slice(a, b < 0 ? undefined : b);
}

const unescape = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const strings = (text) => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1]));

// ["AudioSet class name"] = E("Shown label", "category")
const map = {};
const mapSection = section(
  "public static readonly Dictionary<string, Entry> Map",
  "public static readonly HashSet<string> OwnMoveLabels"
);
for (const m of mapSection.matchAll(/\["((?:[^"\\]|\\.)*)"\]\s*=\s*E\("((?:[^"\\]|\\.)*)",\s*"(\w+)"\)/g)) {
  map[unescape(m[1])] = [unescape(m[2]), m[3]];
}

const ignore = strings(section("public static readonly HashSet<string> Ignore", "};"));
const profile = strings(section('["phasmophobia"] = new HashSet<string>', "},\n    };"));
const woodFamily = strings(section("public static readonly HashSet<string> WoodFamily", "};"));
const clinkFamily = strings(section("public static readonly HashSet<string> ClinkFamily", "};"));
const ownMoveLabels = strings(section("public static readonly HashSet<string> OwnMoveLabels", "};"));

const strictMin = {};
for (const m of section("public static readonly Dictionary<string, float> StrictMin", "};")
  .matchAll(/\["([^"]+)"\]\s*=\s*([\d.]+)f/g)) {
  strictMin[m[1]] = parseFloat(m[2]);
}

const out = {
  _generated: "by tools/extract-labels.js from " + path.basename(SRC),
  map, ignore, profile, woodFamily, clinkFamily, ownMoveLabels, strictMin,
  woodLabel: "Knock / thump",
  clinkLabel: "Clink / click",
  specificScore: 0.5,
};

fs.mkdirSync("app/models", { recursive: true });
fs.writeFileSync("app/models/labels.json", JSON.stringify(out));
console.log(
  `map ${Object.keys(map).length} | ignore ${ignore.length} | profile ${profile.length} | ` +
  `wood ${woodFamily.length} | clink ${clinkFamily.length} | strict ${Object.keys(strictMin).length}`
);
for (const k of ["Screaming", "Footsteps", "Whispering", "Breathing", "Knock"])
  console.log(`  ${k} -> ${JSON.stringify(map[k])}`);
