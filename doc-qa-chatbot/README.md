# Document Q&A Chatbot

A chatbot that answers customer questions from a company's own documents (FAQs, policies, manuals).
Portfolio demo for "AI chatbot for your website / help docs" freelance work.

## Run it (free, no installs)

```bash
node server.mjs
```

Open http://localhost:3000 and ask "What is the refund policy?"
(If port 3000 is busy, run `set PORT=3100` first in Command Prompt, or `$env:PORT=3100` in PowerShell, then open http://localhost:3100.)

- Put `.txt` or `.md` files in `docs/`, or paste text into the page.
- **Free mode** (default): ranks passages with BM25 keyword search and returns the best-matching sentences. It runs offline and costs nothing.

## AI mode (optional, paid per use)

To get natural-language answers written by Claude:

```bash
npm install @anthropic-ai/sdk
set ANTHROPIC_API_KEY=your-key
node server.mjs
```

- You need an API key from console.anthropic.com. The API is **pay-per-use**: each question costs a fraction of a cent to a few cents, depending on the model.
- The default model is `claude-opus-5-5`. Set `CLAUDE_MODEL=claude-haiku-5-5` for the cheapest option.

## How it works

1. Documents are split into passages of about 700 characters.
2. The question is matched against passages with BM25 ranking.
3. The top 3 passages become the answer (free mode) or are sent to Claude as context (AI mode). Claude answers only from those passages and cites them.
