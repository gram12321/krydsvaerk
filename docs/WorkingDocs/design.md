# Design

Record approved product direction and user-facing decisions here. Keep proposals separate from confirmed decisions.

## Product direction

Krydsværk generates and plays Danish-style crosswords, with clues in the grid. Direction arrows for clue answers appear in the designer workshop; preview and finished puzzles omit them.

## Confirmed decisions

- Generate connected horizontal and vertical words of varying lengths from Danish words and clues.
- The built-in dictionary is organized into a hand-written starter list, curated short crossword clues, a separate hyphenated-word collection, clues derived from DanNet, and emoji-to-answer pairs; users can add their own word and clue pairs.
- Users can include or omit each built-in collection. The shared selection applies to designer suggestions and autofill as well as newly generated player puzzles, and persists in Supabase.
- Emoji dictionary entries are available to suggestions and autofill when the collection is enabled. Designers can place a 1 × 1 open emoji clue, which restricts its answer slot to emoji dictionary words matching its length, and can independently request open emoji clues with one answer direction in newly generated designer grids; selecting a matching answer determines the emoji.
- Each custom dictionary has one enabled setting that includes it in both designer suggestions and autofill as well as newly generated player puzzles.
- Users can share their own custom dictionaries and browse other users' shared dictionaries. Adding another user's dictionary creates a read-only local reference that starts disabled; enabling it includes it in both suggestions and autofill.
- A spelling can have multiple clues and a clue can describe multiple spellings. Designers can add distinct pairs and select a clue together with a verified answer; changing answer letters clears affected selected clues.
- Dictionary answers carry their normalized spelling, derived letter count, source, and optional linguistic/concept metadata. Length buckets are derived from the entries for generator lookup.
- Curated answers that can serve the same clue concept share a `clueGroupId`; each answer still has its own spelling, clue, and length so the generator can choose a crossing-compatible variant.
- Imported DanNet clues are one or two words derived from the source synset, a direct hypernym, a short definition, or the Danish city rule. Entries retain their source synset as a clue group. Automatically derived clues have not been individually reviewed.

- The intended crossword format is Scandinavian clues in squares: fill the grid with letters, clues and optional images rather than unused blocks. Clues can share a square, occupy rectangular areas, and use bent arrows to indicate their answers. Grid layouts and answers must be planned together.

## Implemented layout scope

- The editor generates connected, varied templates from balanced, long-run and staggered seed families for 9 × 9, 11 × 11 and 13 × 13 grids. Layouts include longer answer slots, varied 2 × 1 and 1 × 2 clue areas, and black cells. Designers can request a rectangular image area, let the generator choose hyphenated answers automatically, or require one to four such answers when enabled dictionaries contain fitting spellings. Player puzzle generation remains on its separate curated template path.
- The designer's new-grid action checks varied layout candidates with the same complete-fill solver and enabled dictionaries. It accepts only a candidate with a confirmed full fill; candidates whose bounded solver search is inconclusive are not accepted. Generation runs in a worker and preserves the current grid if it cannot confirm a candidate.
- The layout model supports rectangular clue and image areas. Designers drag across grid cells to mark an image area of any size, choose a bundled illustration or upload an image, and drag within the placed image to adjust its crop.
- Edited layouts may contain separate groups of words without crossings between them. Each word still needs a valid clue, and all letter cells must belong to a word.
- An image area is unused as a cue by default. Designers link it to the nearest answer by clicking the marker beside its row or column. Each linked word gets a directional arrow on the image that players can select to answer that word.

## Designer workflow

- Player, workshop, dictionary and preview screens share the tiled wordmark, copper eyebrow lines, compact serif page titles, and numbered `01 / LABEL` card headings. Controls share a compact scale while crossword letters and clues retain their own sizing for readability. The player's direction badge, soft green clue/status panels and understated action buttons also guide the workshop styling.
- The player has a resizable choice-and-crossword split above 1,100 pixels, using the same pointer and keyboard divider as the designer and dictionary tabs. All three workspaces stack at 1,100 pixels and below. Preview shows a single crossword card. The designer's grid setup, drafts and publishing controls are separate numbered cards.
- The dictionary tab uses the crossword tab's numbered serif card headings. Above 1,100 pixels, the archive and selected dictionary appear side by side with the shared pointer- and keyboard-operated width divider; smaller screens stack the cards. The selected dictionary has compact name and delete controls, a collapsible add-word form, and searchable entries. Read-only browsing uses the same right-hand card.
- Select a horizontal or vertical slot and see words matching its length and current letters. A displayed suggestion must have a verified complete solution for the current grid. Search-limited candidates are reported as uncertain. Designers can check whether the whole grid has a fill without inserting its answers.
- The editor starts from a generated template and supports manual letter entry, inserting suggestions, and editing cell types through a toolbar. It derives slots and up to two outward-facing arrows per clue area; rectangular clue areas, dark blocks and directional separators at hyphens are supported. Invalid intermediate layouts highlight affected cells and cannot be searched or published. Designers can autofill one word, fill the whole grid, or check whether a complete fill exists without inserting answers. The designer can set per-word clues and publish one completed puzzle locally to the player page.
- The emoji tool places an open 1 × 1 pictogram clue in the currently selected word direction; the answer chosen from Ordforslag determines the displayed emoji. The generator settings include a checkbox for adding emoji clues to new designer grids; generated candidates must still have a confirmed complete fill from the enabled autofill dictionaries.

