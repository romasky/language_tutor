# Usage Guide

## First Start

Send `/start` to the bot. It will:

1. **Detect your language** — reads your Telegram UI language automatically
2. **Confirm** — asks "I see your Telegram is in Russian. Continue in this language?"
3. **Choose target language** — pick from 80+ languages (paginated, 20 per page)
4. **Level assessment** — 4-question AI interview to determine your level (A1–C1)

After assessment, the main menu appears.

## Commands

### `/word [term]`

Look up any word or phrase. The bot gives:
- Translation in your native language
- Simple definition in the target language
- Two example sentences
- A memory tip in your native language

```
/word ambitious
/word let the cat out of the bag
```

Or tap **📚 Word** in the menu and type the word when prompted.

### `/talk`

Start a conversation practice session. The bot:
- Opens with a simple question in your target language
- Corrects mistakes gently (shows ❌ original → ✅ corrected)
- Keeps the conversation going with follow-up questions
- Responds mostly in your native language at A1–A2, less at B1+

To end the session, tap the menu or send any command.

### `/quiz`

Start a 20-question quiz tailored to your current level. The bot:
- Sends a "preparing..." message while Claude generates the questions
- Asks 10 grammar + 10 vocabulary questions — all in your native language, answer options in the target language
- Shows 4 inline buttons (A / B / C / D) for each question
- After all 20 answers, sends a full AI analysis: score, XP earned, and a clear explanation for every wrong answer

If you close the bot mid-quiz and return, it offers to **continue** from where you left off or **start over**.

Duplicate button taps on already-answered questions are silently ignored.

### `/progress`

Shows your current stats:
- Level (A1–C1)
- XP earned
- Streak (days in a row)

### `/level`

Change your learning level manually. Options: A1, A2, B1, B2, C1.

Each level changes how the bot teaches:
- **A1–A2** — lots of native language, simple words, translations in parentheses
- **B1–B2** — natural conversation, fewer hints
- **C1** — near-native communication, minimal native language

### `/help`

Shows the command list.

## Grammar Practice

Send any sentence in the target language and the bot will check it.
Works in two ways:
- Tap **✍️ Grammar** in the menu → bot asks for a sentence
- Just type a sentence when `grammar_input` session is active

The bot responds with:
```
✅ Correct! [grammar rule explained in your native language]
```
or:
```
❌ [your sentence]
✅ [corrected]
💡 [explanation in your native language]

[follow-up exercise]
```

## Language Selection

The bot supports:
- **14 native languages** for the UI, explanations, and corrections
- **80+ target languages** to learn

If your language isn't auto-detected correctly, tap **🌐 Choose another** on the welcome screen.

## Session Behavior

The bot remembers context within sessions:

- **Grammar** — keeps the last 10 messages as context, so corrections build on each other
- **Conversation** — maintains dialogue context throughout the `/talk` session
- **Onboarding** — 4-question assessment is tracked; progress isn't lost if you pause
