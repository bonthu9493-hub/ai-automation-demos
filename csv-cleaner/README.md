# CSV Data Cleaner

Cleans messy customer and lead spreadsheets in seconds. Portfolio demo for "data cleaning / Excel automation" freelance work.

## Run it (free, no installs)

```bash
node clean.mjs sample-customers.csv
```

Output: `sample-customers.clean.csv`, plus a report of what changed and which values need a human to check them.

## What it does

- Trims extra spaces and removes empty rows
- Emails: lowercase with no spaces, and flags invalid ones
- Phones: strips formatting to digits (keeps a leading `+`), and flags numbers that are too short
- Dates: converts many formats (`03/15/2026`, `25/04/2026`, `2026.06.01`) to ISO `YYYY-MM-DD`
- Names and cities: Title Case
- Removes duplicate rows (case-insensitive, after cleaning)
- Handles quoted fields with commas, such as `"Lee, Chen"`

Columns are detected from header names, so it works on most contact and lead exports from CRMs, forms and shops.
