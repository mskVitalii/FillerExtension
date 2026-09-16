/**
 * spec_5 section B: the standard interview-FAQ questions almost every
 * application eventually asks in some phrasing ("Tell me about yourself",
 * "What are your salary expectations?", …). Pre-generating sensible answers
 * for these (grounded in CV + Personal Legend, see
 * `features/openai/generate-faq.ts`) means a real form's version of one of
 * them gets a consistent, already-reviewed answer instead of a fresh
 * from-scratch guess every time.
 */
export interface FaqQuestion {
  category: string;
  question: string;
}

export const FAQ_QUESTIONS: FaqQuestion[] = [
  { category: "About You", question: "Tell me about yourself." },
  { category: "About You", question: "What are your strengths?" },
  { category: "About You", question: "What is your biggest weakness?" },
  { category: "About You", question: "How do you handle stress or pressure?" },
  { category: "About You", question: "Why are you leaving your current job?" },
  { category: "Skills & Experience", question: "Tell me about a time you faced a challenge at work." },
  { category: "Skills & Experience", question: "What skills make you a good fit for this position?" },
  { category: "Skills & Experience", question: "How do you stay updated with industry trends?" },
  { category: "Skills & Experience", question: "Have you ever had to learn a new skill quickly?" },
  { category: "Skills & Experience", question: "What do you know about our company?" },
  { category: "Goals & Motivation", question: "Why do you want this job?" },
  { category: "Goals & Motivation", question: "Where do you see yourself in five years?" },
  { category: "Goals & Motivation", question: "What motivates you to do your best work?" },
  { category: "Goals & Motivation", question: "What are your salary expectations?" },
  { category: "Goals & Motivation", question: "How do you define success?" },
  { category: "Goals & Motivation", question: "Do you have any questions for us?" },
  { category: "Problem-Solving", question: "How do you approach solving a complex problem?" },
  { category: "Problem-Solving", question: "Describe a time you had to make a quick decision." },
  { category: "Problem-Solving", question: "Tell me about a time you disagreed with a team decision." },
  { category: "Problem-Solving", question: "How do you handle situations with incomplete information?" },
  { category: "Problem-Solving", question: "What's an example of an innovative solution you proposed?" },
];
