// Placeholder until T3/T5: replay mode with no recorded transcripts passes trivially.
const mode = process.argv.includes("--live") ? "live" : "replay";
console.log(JSON.stringify({ mode, transcripts: 0, note: "no transcripts recorded yet" }));
