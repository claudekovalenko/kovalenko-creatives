// Portfolio entries. Add, remove or reorder projects here — the page renders from this list.
// Fields: title, comment (the small "// label" on the dark card top), status (badge, e.g. 'Custom · private'
// until an app is public), description, tags[], slides[] (screenshot paths like 'images/app-1.webp' that
// visitors swipe through; leave empty to show the title on the dark card top instead), url (optional).

// Everything built so far, counted by kind. Only the total is shown on the page, never project names.
const BODY_OF_WORK = [
  { label: 'Apps & tools', count: 44, color: '#0E7C5A' },
  { label: 'Plans, guides & research', count: 18, color: '#4FD1A1' },
  { label: 'Websites', count: 6, color: '#0E1116' },
];

const PROJECTS = [
  {
    title: 'Koine Quest',
    comment: '// 3d learning game',
    status: 'In development',
    description: 'A 3D adventure game that teaches Biblical Greek from the alphabet up. Play an apprentice wizard across nine worlds: teachers explain each rule, then trials, mini-games and spaced-repetition battles put it to work, all the way to reading the New Testament in Greek.',
    tags: ['Game', '3D', 'Offline'],
    slides: ['images/koinequest-1.webp', 'images/koinequest-2.webp', 'images/koinequest-3.webp', 'images/koinequest-4.webp'],
  },
  {
    title: 'N&N Reading Plan',
    comment: '// church app',
    status: 'Custom · private',
    description: 'A sermon companion app for a local church: read each Sunday’s passage through the week, catch up on past messages and follow along as a series unfolds.',
    tags: ['App', 'Church'],
    slides: ['images/nn-1.webp', 'images/nn-2.webp', 'images/nn-3.webp'],
  },
  {
    title: 'Seminary Homework',
    comment: '// planning',
    status: 'Custom · private',
    description: 'Turns a term’s syllabi into a daily plan: what’s due, how much reading that is, and exactly how much to do today.',
    tags: ['App', 'Planning'],
    slides: ['images/seminary-1.webp', 'images/seminary-2.webp'],
  },
  {
    title: 'Greek Vocab',
    comment: '// learning',
    status: 'Custom · private',
    description: 'A flashcard app for Biblical Greek with spaced repetition, quizzes, memory hooks and offline pronunciation.',
    tags: ['App', 'Offline', 'Speech'],
    slides: ['images/greek-1.webp', 'images/greek-2.webp', 'images/greek-3.webp'],
  },
  {
    title: 'Time Cup',
    comment: '// time planning',
    status: 'Custom · private',
    description: 'A week drawn as a cup: non-negotiables settle first, the big things go in next, and everything else fills the gaps. It shows how many big things actually fit.',
    tags: ['App', 'Visual'],
    slides: ['images/timecup-1.webp', 'images/timecup-2.webp', 'images/timecup-3.webp'],
  },
  // Kept deliberately light: no screenshots or details until launch.
  {
    title: 'Next Steps',
    comment: '// creator platform',
    status: 'In development',
    description: 'A platform that helps content creators turn an audience into real next steps. More to share at launch.',
    tags: ['Platform', 'Creators'],
    slides: [],
  },
];
