// Portfolio entries. Add, remove or reorder projects here — the page renders from this list.
// Fields: title, category, description, features[], tags[], color (card backdrop),
// slides[] (pictures to cycle through: an image path like 'images/app-1.png', or HTML for a mock screen
// filled with sample data only), status (optional badge), url (optional).
// The featured project is shown large above the grid. Keep its details deliberately light.
const FEATURED = {
  title: 'Next Steps',
  status: 'In development',
  description: 'The main project: a platform that helps content creators turn an audience into real next steps. More to share soon.',
  color: '#0f6b62',
  slides: [`
    <div class="mock mock-dark" style="--a:#4fc2b3">
      <div class="mock-top"><span>Next steps</span><span class="mock-pill">Soon</span></div>
      <div class="mock-steps"><i class="on"></i><i class="on"></i><i></i></div>
      <div class="mock-bar"></div><div class="mock-bar short"></div>
      <div class="mock-blocks"><i></i><i></i><i></i></div>
      <div class="mock-btn">Take the next step</div>
    </div>`,
    `<div class="mock mock-dark" style="--a:#4fc2b3">
      <div class="mock-top"><span>Step 2 of 3</span><span class="mock-pill">Soon</span></div>
      <div class="mock-steps"><i class="on"></i><i class="on"></i><i></i></div>
      <div class="mock-video"></div>
      <div class="mock-bar"></div><div class="mock-bar short"></div>
      <div class="mock-btn">Continue</div>
    </div>`],
};

const PROJECTS = [
  {
    title: 'N&N Reading Plan',
    category: 'Church',
    description: 'A sermon companion app for a local church: read each Sunday’s passage through the week, catch up on past messages and follow along as a series unfolds.',
    features: [
      'Daily Mon–Sat reading check-offs ahead of Sunday',
      'Every week of the series with passage, big idea and discussion questions',
      'Calendar reminders, offline use, no account needed',
    ],
    tags: ['Installable', 'Works offline', 'Reusable per series'],
    color: '#b5832a',
    slides: ['images/nn-1.webp', 'images/nn-2.webp', 'images/nn-3.webp'],
  },
  {
    title: 'Seminary Homework',
    category: 'Study',
    description: 'Turns a term’s syllabi into a daily plan: what’s due, how much reading that is, and exactly how much to do today.',
    features: [
      'Daily reading target in minutes, split at real page numbers',
      'Plan re-spreads automatically if you fall behind',
      'Reminders for anything due inside your warning window',
    ],
    tags: ['Installable', 'Single-file build', 'No server'],
    color: '#4a55a8',
    slides: ['images/seminary-1.webp', 'images/seminary-2.webp'],
  },
  {
    title: 'Greek Vocab',
    category: 'Study',
    description: 'A flashcard app for Biblical Greek with spaced repetition, quizzes, memory hooks and offline pronunciation.',
    features: [
      'Again / Hard / Good / Easy spaced-repetition review',
      'Built-in memory hooks you can edit or regenerate',
      'Hear each word in Koine, Erasmian or Modern pronunciation',
    ],
    tags: ['Installable', 'Works offline', 'Spaced repetition'],
    color: '#1a2238',
    slides: ['images/greek-1.webp', 'images/greek-2.webp', 'images/greek-3.webp'],
  },
  {
    title: 'Time Cup',
    category: 'Productivity',
    description: 'A week drawn as a cup: non-negotiables settle first, the big things you want the week to be about go in next, and everything else fills the gaps. It shows how many of those big things actually fit.',
    features: [
      'Cup drawn to scale, with levels sized by volume',
      'One dial for how big a “rock” is, and how many fit',
      'Overflow and unclaimed time shown, not hidden',
    ],
    tags: ['Installable', 'Works offline', 'Custom SVG drawing'],
    color: '#d9782d',
    slides: ['images/timecup-1.webp', 'images/timecup-2.webp', 'images/timecup-3.webp'],
  },
];
