// Portfolio entries. Add, remove or reorder projects here — the page renders from this list.
// Fields: title, category, description, features[], tags[], color (card backdrop),
// preview (HTML for a mock screen, filled with sample data only), status (optional badge), url (optional).
// The featured project is shown large above the grid. Keep its details deliberately light.
const FEATURED = {
  title: 'Next Steps',
  status: 'In development',
  description: 'The main project: a platform that helps content creators turn an audience into real next steps. More to share soon.',
  color: '#0f6b62',
  preview: `
    <div class="mock mock-dark" style="--a:#4fc2b3">
      <div class="mock-top"><span>Next steps</span><span class="mock-pill">Soon</span></div>
      <div class="mock-steps"><i class="on"></i><i class="on"></i><i></i></div>
      <div class="mock-bar"></div><div class="mock-bar short"></div>
      <div class="mock-blocks"><i></i><i></i><i></i></div>
      <div class="mock-btn">Take the next step</div>
    </div>`,
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
    preview: `
      <div class="mock mock-light" style="--a:#b5832a">
        <div class="mock-top"><span>This week</span><span class="mock-pill">Romans</span></div>
        <div class="mock-title">Romans 1:1–7</div>
        <div class="mock-sub">Read it each day before Sunday</div>
        <div class="mock-days">
          <i class="on">M</i><i class="on">T</i><i class="on">W</i><i>T</i><i>F</i><i>S</i>
        </div>
        <div class="mock-btn">Read passage</div>
      </div>`,
  },
  {
    title: 'Seminary Homework',
    category: 'Study',
    description: 'Turns a term’s syllabi into a daily plan — what’s due, how much reading that is, and exactly how much to do today.',
    features: [
      'Daily reading target in minutes, split at real page numbers',
      'Plan re-spreads automatically if you fall behind',
      'Reminders for anything due inside your warning window',
    ],
    tags: ['Installable', 'Single-file build', 'No server'],
    color: '#2a3160',
    preview: `
      <div class="mock mock-dark" style="--a:#7b8cff">
        <div class="mock-top"><span>Today</span><span class="mock-pill">On track</span></div>
        <div class="mock-big">42<small> min</small></div>
        <div class="mock-sub">Theology text · pp. 530–546</div>
        <div class="mock-list">
          <div><b>Greek quiz</b><span>Thu</span></div>
          <div><b>Reading response</b><span>Fri</span></div>
        </div>
      </div>`,
  },
  {
    title: 'Greek Vocab',
    category: 'Study',
    description: 'A flashcard app for Biblical Greek with spaced repetition, quizzes, sound-alike memory hooks and offline pronunciation.',
    features: [
      'Again / Hard / Good / Easy spaced-repetition review',
      'Built-in memory hooks you can edit or regenerate',
      'Hear each word in Koine, Erasmian or Modern pronunciation',
    ],
    tags: ['Installable', 'Works offline', 'Spaced repetition'],
    color: '#1a2238',
    preview: `
      <div class="mock mock-dark" style="--a:#ffb703">
        <div class="mock-top"><span>Review · 12 left</span><span class="mock-pill">🔊</span></div>
        <div class="mock-greek">ἀγάπη</div>
        <div class="mock-sub">love</div>
        <div class="mock-grade">
          <i style="--g:#f87171">Again</i><i style="--g:#fbbf24">Hard</i><i style="--g:#34d399">Good</i><i style="--g:#4cc9f0">Easy</i>
        </div>
      </div>`,
  },
  {
    title: 'Rhythm',
    category: 'Productivity',
    description: 'Log your time by talking: say what you’ve been doing and it becomes categorised entries on the clock, with insight into where the day actually went.',
    features: [
      'One-button voice capture, or catch up on a whole day at once',
      'Flags side quests — the detours and interruptions',
      'Timeline, focus runs and trends over 7–30 days',
    ],
    tags: ['Voice input', 'AI categorisation', 'React + TypeScript'],
    color: '#2a78d6',
    preview: `
      <div class="mock mock-light" style="--a:#2a78d6">
        <div class="mock-top"><span>Today</span><span class="mock-pill">6h 40m</span></div>
        <div class="mock-strip">
          <i style="flex:3;background:#2a78d6"></i><i style="flex:1;background:#eb6834"></i><i style="flex:2;background:#1baf7a"></i><i style="flex:.6;background:#eda100"></i><i style="flex:2;background:#2a78d6"></i>
        </div>
        <div class="mock-list">
          <div><b>Deep work</b><span>3h 10m</span></div>
          <div><b>Side quests</b><span>18%</span></div>
        </div>
        <div class="mock-mic"></div>
      </div>`,
  },
];
