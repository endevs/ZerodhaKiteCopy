/**
 * OpenBook product page: screenshot gallery (files under /android/openbook/screenshots/).
 * Order matches numeric filenames 1.jpg … 8.jpg.
 */

export interface OpenBookScreenshot {
  src: string;
  title: string;
  body: string;
}

export const openBookApkPath = '/android/openbook/app-release.apk';

export const openBookScreenshots: OpenBookScreenshot[] = [
  {
    src: '/android/openbook/screenshots/1.jpg',
    title: 'Welcome to OpenBook',
    body:
      'OpenBook opens with a clear brand moment: the open-book logo and name, plus the tagline Snap. Revise. Succeed. That line is the core loop—capture study material with your phone, turn it into something you can revise, and build toward better results.',
  },
  {
    src: '/android/openbook/screenshots/2.jpg',
    title: 'Start as a guest',
    body:
      'The home screen greets you with “Hello, Guest!” and one main action: Snap & Revise. Tap it to photograph a book page or choose an image from your gallery—no signup required to try the flow. Use Sign In when you want your dashboard and history saved to your account.',
  },
  {
    src: '/android/openbook/screenshots/3.jpg',
    title: 'Sign in with Google or try the demo',
    body:
      'Continue with Google for a quick, familiar login, or tap Continue as Guest (Demo) to explore first. Signing in unlocks the Dashboard and History so your revision sessions stay organized across devices.',
  },
  {
    src: '/android/openbook/screenshots/4.jpg',
    title: 'Three ways to bring in content',
    body:
      'The Snap & Revise screen lets you Take Photo for a live shot of a textbook or notes, Pick from Gallery for an existing photo, or Paste or type text when you already have text on the clipboard. That flexibility means paper books, screenshots, and typed notes all feed the same revision experience.',
  },
  {
    src: '/android/openbook/screenshots/5.jpg',
    title: 'Dashboard: see how you are doing',
    body:
      'The Dashboard summarizes Questions, Correct answers, Accuracy, and Best Streak, plus Daily Analytics and a Weekly Activity chart. Students get a single place to see effort, accuracy, and consistency—useful for building a daily study habit.',
  },
  {
    src: '/android/openbook/screenshots/6.jpg',
    title: 'Review every question after a quiz',
    body:
      'After a set of questions, Review Questions & Answers shows your score, time taken, and each item with correct/incorrect markers. Filter by All, Wrong only, or Skipped only to focus on mistakes. Expand a row to dig into explanations—ideal for fixing gaps instead of only seeing a final grade.',
  },
  {
    src: '/android/openbook/screenshots/7.jpg',
    title: 'Interactive quizzes with clear progress',
    body:
      'Quizzes show progress (e.g. Question 1 of 10) and language. Multiple-choice options are tappable cards; correct selections are highlighted with feedback. A Next control moves you through the set so revision stays structured and easy to follow on a phone.',
  },
  {
    src: '/android/openbook/screenshots/8.jpg',
    title: 'Progress panel during a quiz',
    body:
      'The Progress overlay summarizes Correct, Wrong, Skipped, and Pending counts and lists each question’s status. A legend explains the icons, and Save & go home offers a clean exit. Students always know how far they are through a session and what still needs attention.',
  },
];

export const openBookBenefits: string[] = [
  'Turn physical book pages and notes into digital revision in seconds—camera, gallery, or paste.',
  'Practice with quizzes, instant feedback, and filters that focus on what you got wrong.',
  'Track accuracy, streaks, and weekly activity from the Dashboard when you sign in.',
  'Start as a guest to try the app; add Google sign-in when you want history and dashboard sync.',
];
