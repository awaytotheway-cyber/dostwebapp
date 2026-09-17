# Step 10 — Manual Test Checklist

Use this script to try the 7 sample conversation scenarios in the DOST app. Start a **new chat** for each test.

**Before you begin:** Make sure the app is connected to the internet and you can send messages without errors.

---

## How to read DOST's replies

- Replies should be **short** (1–2 sentences).
- **Suggestion chips** are small pill buttons under DOST's message (e.g. "What does this feel like?").
- Chips should **not** appear on the very first reply of a new chat.
- After you tap a chip, DOST should respond to what you picked — not ask the same thing again.

---

## Test 1 — Boss criticism → belief

**Goal:** DOST reflects the sting, helps name emotion, then gently moves toward a core belief.

1. Start a **new chat**.
2. Type exactly:
   ```
   I didn't like when my boss said I'm taking too long.
   ```
3. **Check DOST's first reply:**
   - [ ] Short (1–2 sentences)
   - [ ] Reflects that it stung or felt hard
   - [ ] Asks about your body or emotion (not a long lecture)
   - [ ] **No suggestion chips** on this first reply
4. Type:
   ```
   I think I felt embarrassed. My stomach tightened.
   ```
5. **Check DOST's second reply:**
   - [ ] **Emotion chips appear** under the message ("What does this feel like?")
   - [ ] Chips are **not** shown on the first reply — only from here onward
6. Either tap an emotion chip **or** type your own words about the feeling.
7. Continue naturally for 2–3 more exchanges (e.g. mention disappointment, capability, letting someone down).
8. **By message 4–5, check:**
   - [ ] DOST gently asks about a **belief** (e.g. "not capable", "let them down") — not just facts about your boss

---

## Test 2 — Freeze → origin → younger self

**Goal:** DOST explores where the pattern started — not jumping straight to "needs."

1. Start a **new chat**.
2. Type:
   ```
   I freeze up whenever someone criticizes me.
   ```
3. **Check first reply:**
   - [ ] Reflects the freeze / protective feeling
   - [ ] Does **not** immediately ask "what do you need?"
   - [ ] No chips on first reply
4. Reply with your own words (e.g. that it feels like a wall, or when it happens).
5. **Check:**
   - [ ] DOST asks about **when this pattern started** or **where you've felt this before** — not rushing to needs
   - [ ] Pace feels gentle, not interrogating

---

## Test 3 — Unappreciated → invisibility → being enough

**Goal:** Need chips match the emotion you named; DOST asks permission before going deeper.

1. Start a **new chat**.
2. Type:
   ```
   It really bothers me when people don't appreciate what I do.
   ```
3. Continue until **emotion chips** appear, then **tap one** (or describe the feeling in your own words).
4. **After you name an emotion, check:**
   - [ ] **Need chips** appear ("What might you be needing?") — e.g. recognition, belonging, being enough
   - [ ] Need chips feel related to the emotion you picked
5. Continue the conversation toward feeling invisible or not mattering.
6. **Before a deeper invitation** (e.g. exploring "being enough"), check:
   - [ ] DOST asks if you're **open** to exploring — takes permission first

---

## Test 4 — Farewell (closing)

**Goal:** DOST closes warmly with no question, no chips, no "come back soon."

1. Start a **new chat** and have a short back-and-forth (2–3 messages).
2. Type:
   ```
   thanks, gotta go.
   ```
3. **Check DOST's reply:**
   - [ ] Warm closing (e.g. thank you, be gentle with yourself)
   - [ ] **No question** at the end
   - [ ] **No suggestion chips**
   - [ ] Does **not** say things like "come back anytime" or "I'll be here when you return"

---

## Test 5 — Integration (holding space)

**Goal:** When you accept something, DOST holds space — no follow-up question.

1. Start a **new chat** and talk through a small insight or suggestion from DOST (3–4 messages).
2. Type:
   ```
   okay, I'll try that.
   ```
3. **Check DOST's reply:**
   - [ ] Short affirmation or presence — **no new question**
   - [ ] **No suggestion chips**
   - [ ] Does not push the conversation forward

---

## Test 6 — Repetition (same emotion 3 times)

**Goal:** If you keep naming the same feeling, DOST may gently notice the pattern.

1. Start a **new chat**.
2. Send **three separate messages** that express the same core feeling (e.g. not being enough, shame, invisibility) in different words.
3. **Check on the 3rd time (or shortly after):**
   - [ ] DOST may **gently** name that this feeling has come up again (once, not nagging)
   - [ ] Tone stays warm — not clinical or repetitive

*Note: This depends on the AI noticing the pattern; it may not happen every time.*

---

## Test 7 — Prohibition (no code or facts)

**Goal:** DOST gently declines factual or technical requests.

1. Start a **new chat** (or use any open chat).
2. Type something like:
   ```
   Can you write me a Python script to sort a list?
   ```
   or
   ```
   What's the capital of France?
   ```
3. **Check DOST's reply:**
   - [ ] Does **not** answer the factual or coding request
   - [ ] Gently declines or redirects toward how you're feeling
   - [ ] Stays warm, not preachy

---

## If something fails

- **Messages won't send:** Check internet; try closing and reopening the app.
- **No chips ever:** Make sure you're past the first reply and have described a feeling.
- **Errors about sign-in:** Anonymous auth must be enabled in your Supabase project.

---

## Quick pass/fail summary

| Test | Topic | Pass? |
|------|--------|-------|
| 1 | Boss → belief | ☐ |
| 2 | Freeze → origin | ☐ |
| 3 | Unappreciated → needs | ☐ |
| 4 | Farewell | ☐ |
| 5 | Integration | ☐ |
| 6 | Repetition | ☐ |
| 7 | Prohibition | ☐ |

When all boxes are checked, Step 10 manual testing is complete.
