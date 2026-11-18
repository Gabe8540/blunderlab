# Blunder Lab made by Claude

**Current version: 1.11.1**

Chess game review and training for chess.com players. Runs as a Chrome extension on a computer and as a web app on iPhone, iPad or any browser.

## Features

**Review**
- Stockfish rates every move: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder
- New games are found and reviewed automatically when they finish
- Games sorted into categories: rapid, blitz, bullet, daily and Chess960, each showing its time control (10 min, 3|2 and so on)
- Chess960 games are reviewed too, with their own rating chart
- Games against chess.com's computer bots can be pasted in, with the bot's name and rating, your rating and the date (quick picks for chess.com's bots, your current ratings and recent dates), and get their own category
- Games you pasted in can be edited later: your side, the opponent, both ratings and the date
- Pasting accepts a full PGN, a bare move list, or moves copied from a game page (piece symbols and move times are fine)
- "Review all" for every game not yet reviewed
- Add any game you played by pasting its chess.com link, however old it is
- Game rating for both players (the level each side played at)
- Match chess.com: paste or type chess.com's accuracy, game rating and move counts for a game, and accuracy, game ratings and move ratings tune themselves to match chess.com across all your games; games with chess.com's numbers copied in are marked "chess.com ✓"
- Training games: add other players' games with chess.com's numbers to tune the estimates further, kept hidden from everything else
- "Explain this move": why the best move works and what yours allowed, in plain words
- Head-to-head history when you have played the opponent before
- Eval graph, clock graph (time spent on each move), best lines you can step through
- Arrow keys on a computer, swipe on a phone

**Puzzles**
- Every mistake, miss or blunder you made becomes a puzzle
- Wrong tries never reveal the answer
- Tagged by theme: fork, pin, skewer, free piece, checkmate, back-rank mate and more
- Solve one on the first attempt and it is finished; missed ones keep coming back
- After a puzzle, see the engine's best lines from that position (and your own move's line) and play through any of them
- Daily puzzles: five new made-up puzzles of every type each day, with a streak for full sets
- When a type runs out, new puzzles of that type are made up by the engine

**Trainer**
- My opponents: play your opening against the moves your real opponents played
- Play a game: a full game against Stockfish at your level, reviewed when it ends
- Your double: a bot that plays like you, with your openings from your game history and mistakes as often and as big as yours from your reviewed games
- Blunder check: quick-fire "is this move safe?" drill from your own games
- Scout: look up any chess.com player's openings and weak lines, and play against their moves
- Openings: starter main lines, the openings you play, and about 3,200 named openings to learn and test
- Repertoire: pick your openings and see where you left them in your games
- Endgames: play out winning or level endgames from your own games against Stockfish

**Insights**
- Plain-language findings from every game you have played: weak colour, the clock, tilt after losses, long sessions, best time of day, problem openings, early collapses, recent trend
- Your score by colour, time control, opponent rating (against what the ratings expect), game length, time of day, weekday, and after a win or loss
- How your wins and losses end (checkmate, resignation, time) and your streaks
- This week against last week
- Rating over time with a projection
- Goals and streaks: a rating target, puzzles a day, reviews a week
- Opening report card: time in theory, early accuracy and where you usually slip
- Mistakes by type, and whether they come from rushing or time trouble
- Opponents you have played more than once, with your record against each
- Your whole game history from chess.com, back to your first game
- Results by colour and opening, and where the big errors happen

**Devices**
- Layout adapts to phone, tablet and desktop
- The web app works offline once it has been opened online
- Reviews, puzzle progress, repertoire and settings sync between devices through a private GitHub gist

Setup for phones and syncing is in `PHONE-AND-SYNC.txt`. Open-source parts and their licences are in `LICENSES.txt`.
