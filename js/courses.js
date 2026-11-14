// Opening lessons written for Blunder Lab: a starter set of main lines, and the ideas behind each opening family.
export const CORE = [
  { group: 'As White', name: 'Italian Game: the slow build-up', side: 'w', family: 'Italian Game', line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 h3' },
  { group: 'As White', name: 'Ruy Lopez: Closed main line', side: 'w', family: 'Ruy Lopez', line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3' },
  { group: 'As White', name: 'Scotch Game: main line', side: 'w', family: 'Scotch Game', line: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4' },
  { group: 'As White', name: 'Vienna Gambit', side: 'w', family: 'Vienna Game', line: 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3' },
  { group: 'As White', name: 'London System', side: 'w', family: 'London System', line: 'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O Bd3' },
  { group: 'As White', name: 'Queen’s Gambit Declined: main line', side: 'w', family: "Queen's Gambit Declined", line: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 Bd3' },
  { group: 'As White', name: 'Queen’s Gambit Accepted: main line', side: 'w', family: "Queen's Gambit Accepted", line: 'd4 d5 c4 dxc4 e3 Nf6 Bxc4 e6 Nf3 c5 O-O a6 Qe2' },
  { group: 'As White', name: 'English Opening: reversed Sicilian', side: 'w', family: 'English Opening', line: 'c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6 O-O Be7 d3' },
  { group: 'As Black against 1.e4', name: 'Sicilian Najdorf: English Attack', side: 'b', family: 'Sicilian Defense', line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O' },
  { group: 'As Black against 1.e4', name: 'Sicilian Dragon: Yugoslav Attack', side: 'b', family: 'Sicilian Defense', line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6' },
  { group: 'As Black against 1.e4', name: 'French Defense: Advance Variation', side: 'b', family: 'French Defense', line: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 Be2 cxd4 cxd4 Nge7' },
  { group: 'As Black against 1.e4', name: 'Caro-Kann: Classical Variation', side: 'b', family: 'Caro-Kann Defense', line: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6' },
  { group: 'As Black against 1.e4', name: 'Scandinavian Defense: main line', side: 'b', family: 'Scandinavian Defense', line: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6' },
  { group: 'As Black against 1.e4', name: 'Two Knights Defense: main line', side: 'b', family: 'Italian Game', line: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4' },
  { group: 'As Black against 1.d4', name: 'King’s Indian Defense: Classical', side: 'b', family: "King's Indian Defense", line: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7' },
  { group: 'As Black against 1.d4', name: 'Slav Defense: main line', side: 'b', family: 'Slav Defense', line: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O' },
  { group: 'As Black against 1.d4', name: 'Nimzo-Indian Defense: Rubinstein', side: 'b', family: 'Nimzo-Indian Defense', line: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6' },
  { group: 'As Black against 1.d4', name: 'Grünfeld Defense: Exchange', side: 'b', family: 'Grünfeld Defense', line: 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5' }
];

// The plan behind each opening family, for both sides. Looked up by the start of the opening's name.
export const IDEAS = {
  'Italian Game': 'White aims the bishop at f7, Black’s weakest square, and builds slowly with c3 and d3 before pushing d4. Black copies the set-up and looks for ...d5 at the right moment. Watch for knight jumps to g5 against f7 and for pins with a bishop on g4 or g5.',
  'Ruy Lopez': 'The bishop on b5 pressures the knight that guards e5, so White keeps a small, lasting pull on the centre. White’s plan is c3 and d4, then a slow kingside build-up with the knight going d2-f1-g3. Black gains space with ...a6 and ...b5 and tries to free the game with ...d5 or ...c5.',
  'Scotch Game': 'White opens the centre at once with d4, getting free piece play and more space. Black gets easy development in return and hits back at e4. Games are open and tactical: develop fast and castle early.',
  'Vienna Game': 'White holds back the king’s knight so the f-pawn can go to f4, a delayed King’s Gambit with the knight on c3 already guarding e4. Black’s best answer to f4 is the counter-strike ...d5.',
  'Four Knights Game': 'Both sides develop the knights first. It is solid and symmetrical; White looks for a small edge with Bb5 or d4, Black usually equalises by keeping pieces active and not falling behind in development.',
  "King's Gambit": 'White gives up the f-pawn to pull Black’s e-pawn away, take the centre with d4 and attack down the f-file. Black either keeps the pawn with ...g5 or gives it back for fast development with ...d5.',
  "Petrov's Defense": 'Black answers the attack on e5 by attacking e4. It is very solid and often symmetrical. After Nxe5, do not take on e4 at once: play ...d6 first, or Qe2 wins material.',
  'Philidor Defense': 'Black props up e5 with ...d6 and sets up compactly with ...Nf6, ...Be7 and ...O-O. It is solid but a little passive: White gets more space and should simply develop with d4, Nc3 and Bc4.',
  'Sicilian Defense': 'Black fights for d4 with a wing pawn, so after White plays d4 and Black takes, Black has an extra centre pawn and a half-open c-file. White gets a lead in development and attacks on the kingside; Black counter-attacks on the queenside and down the c-file. Timing matters more than in most openings.',
  'French Defense': 'Black lets White have the centre with e4 and d4, then attacks it with ...d5 and ...c5. The price is the bishop on c8, stuck behind the e6 pawn. Black attacks the d4 pawn and the queenside; White has space and chances on the kingside.',
  'Caro-Kann Defense': 'Like the French, Black supports ...d5, but with the c-pawn, so the light bishop can come out to f5 or g4 before ...e6. Black gets a rock-solid position with no bad piece; White gets a little more space.',
  'Scandinavian Defense': 'Black trades White’s e-pawn at once. The queen comes out early and loses a move to Nc3, but Black gets a simple, solid set-up with ...c6, ...Bf5 and ...e6, the same structure as the Caro-Kann.',
  'Pirc Defense': 'Black lets White build a big centre, fianchettoes the king’s bishop and strikes back later with ...e5 or ...c5. White can attack fast with f4 or with Be3, Qd2 and a kingside pawn storm.',
  'Modern Defense': 'Black plays ...g6 and ...Bg7 before anything else and keeps the centre pawns flexible. White gets a free hand in the centre; Black is betting on hitting it later with ...c5, ...e5 or ...d5.',
  'Alekhine Defense': 'Black tempts White’s pawns forward by attacking them with the knight, hoping they become targets. White gets a big space advantage; Black must chip away at it with ...d6 and ...c5.',
  "Queen's Gambit Declined": 'Black holds the d5 point with ...e6 and develops solidly. White presses with Bg5 and the c-file and often plays the minority attack with b4-b5. Black’s freeing breaks are ...c5 and ...e5, and the main problem piece is the bishop on c8.',
  "Queen's Gambit Accepted": 'Black takes the c4 pawn but does not try to keep it; the point is to develop freely and hit the centre with ...c5. White wins the pawn back with e3 and Bxc4 and gets a slight lead in the centre.',
  "Queen's Gambit": 'White offers the c-pawn to pull Black’s d-pawn away from the centre. It is not a real sacrifice: White can always win the pawn back. Black chooses between holding d5 with ...e6 or ...c6 and taking on c4.',
  'Slav Defense': 'Black supports d5 with ...c6, keeping the light bishop free to come out to f5 or g4. Black often takes on c4 and makes White spend time winning the pawn back. Very solid, with fewer bad pieces than the Queen’s Gambit Declined.',
  'Semi-Slav Defense': 'Black plays both ...c6 and ...e6: a very solid triangle of pawns, with the plan of ...dxc4 and ...b5 to gain space on the queenside. The lines are sharp and worth knowing well.',
  'London System': 'White plays the same set-up against almost anything: d4, Bf4, e3, c3, Nf3, Bd3 and Nbd2. The dark bishop gets outside the pawn chain before e3. Plans are a knight landing on e5 and a kingside attack; Black’s best counters are ...c5 with ...Qb6 against b2, or trading the f4 bishop with ...Bd6.',
  "Queen's Pawn Game": 'White starts with d4 but does not play an early c4. Set-ups like the London, Colle and Torre are about reaching a familiar structure rather than fighting for an immediate advantage.',
  "King's Indian Defense": 'Black lets White build a huge centre, then hits it with ...e5. Once the centre locks with d5, the game becomes a race: White attacks on the queenside with c5, Black attacks the king with ...f5, ...f4 and ...g5.',
  'Nimzo-Indian Defense': 'Black pins the c3 knight to stop e4, and is ready to give up the bishop pair to double White’s c-pawns. Black then plays against those pawns and the light squares; White relies on the two bishops and the centre.',
  "Queen's Indian Defense": 'Black controls e4 from a distance with ...b6 and ...Bb7 instead of occupying the centre. Solid and flexible; the fight is over whether White can get e4 in.',
  'Grünfeld Defense': 'Black lets White have a big pawn centre and then attacks it straight away with ...c5, ...Bg7 and ...Nc6, all aimed at d4. White must use the centre before it turns into a target.',
  'Dutch Defense': 'Black grabs e4 with the f-pawn and plays for a kingside attack. It weakens Black’s own king, so development and king safety need care. White often answers with g3 and Bg2.',
  'English Opening': 'White controls d5 from the side with c4, often followed by g3 and Bg2. After 1...e5 it is a Sicilian with colours reversed and an extra move. Plans are flexible: queenside expansion with b4, or a later central break.',
  'Benoni Defense': 'Black gives White a space-gaining pawn on d5 in return for a queenside pawn majority and a strong bishop on g7. Black plays for ...b5; White plays for e5 in the centre.',
  'Catalan Opening': 'A Queen’s Gambit with the bishop on g2. That bishop pressures the long diagonal all game, and White often wins back the c4 pawn at leisure while Black struggles to develop the queenside.',
  "Bishop's Opening": 'White develops the bishop to c4 first, keeping the option of f4 or a quiet d3 set-up. It often turns into the Italian Game or the Vienna.',
  'Englund Gambit': 'Black gives up a pawn with 1...e5 hoping for a quick trap. If White knows the trap and develops calmly, Black is simply a pawn down.',
  'Zukertort Opening': '1.Nf3 keeps every option open: White can still go into a Queen’s Gambit, an English, or a King’s Indian set-up, depending on what Black does.',
  'Réti Opening': 'White attacks d5 from the side with Nf3 and c4 and fianchettoes one or both bishops, controlling the centre with pieces rather than pawns.'
};
export function ideaFor(name) {
  const fam = name.split(':')[0];
  if (IDEAS[fam]) return IDEAS[fam];
  const k = Object.keys(IDEAS).find(x => fam.startsWith(x) || name.includes(x));
  return k ? IDEAS[k] : '';
}
