#!/usr/bin/env node
// CSV cleaner — zero dependencies.
// Usage: node clean.mjs input.csv [output.csv]
// Trims whitespace, normalizes emails/phones/dates/names, removes duplicates and empty rows,
// and writes a report of every change.
import fs from "node:fs";

const [input, output = input.replace(/\.csv$/i, "") + ".clean.csv"] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node clean.mjs input.csv [output.csv]");
  process.exit(1);
}

// RFC 4180 parser: handles quoted fields, escaped quotes and newlines inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const toCSV = (rows) =>
  rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

function normalizeDate(v) {
  let m;
  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return iso(m[1], m[2], m[3]);
  // Ambiguous d/m vs m/d: treat as day-first only when the first number can't be a month.
  if ((m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    return Number(m[1]) > 12 ? iso(m[3], m[2], m[1]) : iso(m[3], m[1], m[2]);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function iso(y, mo, d) {
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  return date.getUTCMonth() === +mo - 1 ? date.toISOString().slice(0, 10) : null;
}

// Column rules are picked by header name.
const rules = [
  { match: /e-?mail/i, fix: (v) => v.toLowerCase().replace(/\s+/g, ""), check: (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) },
  { match: /phone|mobile|tel/i, fix: (v) => { const d = v.replace(/[^\d+]/g, ""); return d.startsWith("+") ? "+" + d.slice(1).replace(/\+/g, "") : d.replace(/\+/g, ""); }, check: (v) => v.replace(/\D/g, "").length >= 7 },
  { match: /date|dob|joined|created/i, fix: (v) => normalizeDate(v) ?? v, check: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) },
  { match: /^(first|last|full)?[ _]?name$|city|country/i, fix: titleCase },
];

const rows = parseCSV(fs.readFileSync(input, "utf8").replace(/^﻿/, ""));
const header = rows.shift().map((h) => h.trim());
const colRules = header.map((h) => rules.find((r) => r.match.test(h)));

const report = { input: rows.length, emptyRemoved: 0, duplicatesRemoved: 0, cellsChanged: 0, invalid: [] };
const seen = new Set();
const out = [];

rows.forEach((raw, idx) => {
  const lineNo = idx + 2;
  const row = header.map((_, c) => (raw[c] ?? "").replace(/\s+/g, " ").trim());
  if (row.every((v) => v === "")) { report.emptyRemoved++; return; }
  row.forEach((v, c) => {
    const rule = colRules[c];
    if (!rule || !v) return;
    const fixed = rule.fix(v);
    if (fixed !== v) report.cellsChanged++;
    row[c] = fixed;
    if (rule.check && !rule.check(fixed)) report.invalid.push(`line ${lineNo}, ${header[c]}: "${v}"`);
  });
  const key = row.join("\u0001").toLowerCase();
  if (seen.has(key)) { report.duplicatesRemoved++; return; }
  seen.add(key);
  out.push(row);
});

fs.writeFileSync(output, toCSV([header, ...out]));

console.log(`Cleaned ${input} -> ${output}`);
console.log(`  rows in: ${report.input}, rows out: ${out.length}`);
console.log(`  empty rows removed: ${report.emptyRemoved}`);
console.log(`  duplicate rows removed: ${report.duplicatesRemoved}`);
console.log(`  cells normalized: ${report.cellsChanged}`);
if (report.invalid.length) {
  console.log(`  values needing review (${report.invalid.length}):`);
  report.invalid.forEach((x) => console.log("    - " + x));
}
