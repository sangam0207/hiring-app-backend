const openai = require("../config/openai");

/**
 * Generate 5 interview questions tailored to the job and candidate profile
 */
const generateInterviewQuestions = async (job, parsedResume = null) => {
  const candidateContext = parsedResume
    ? `
Candidate Profile:
- Skills: ${parsedResume.extractedSkills?.join(", ") || "N/A"}
- Experience: ${parsedResume.totalExperience || "N/A"} years
- Current Role: ${parsedResume.currentRole || "N/A"}
- Summary: ${parsedResume.aiSummary || "N/A"}
- Strengths: ${parsedResume.strengths?.join(", ") || "N/A"}
- Gaps: ${parsedResume.gaps?.join(", ") || "N/A"}`
    : "";

  const systemPrompt = `You are an expert technical interviewer. Generate interview questions that are specific, practical, and assess both technical skills and problem-solving ability. Always respond with valid JSON only.`;

  const userPrompt = `Generate exactly 5 interview questions for this role. Mix technical, behavioral, and situational questions. Tailor them to the job requirements and candidate profile.

=== JOB DETAILS ===
Title: ${job.title}
Description: ${job.description}
Requirements: ${job.requirements}
Required Skills: ${job.requiredSkills.join(", ")}
Experience Level: ${job.experienceLevel}
${candidateContext}

=== REQUIRED JSON FORMAT ===
{
  "questions": [
    "Question 1 text here",
    "Question 2 text here",
    "Question 3 text here",
    "Question 4 text here",
    "Question 5 text here"
  ]
}

Guidelines:
- Q1: Technical question about a core required skill
- Q2: Practical scenario/problem-solving question
- Q3: Behavioral question (past experience)
- Q4: Technical question about another required skill or system design
- Q5: Situational question about teamwork/challenges
- Keep questions concise (1-2 sentences each)
- If candidate has gaps, ask about those areas to assess learning ability`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 1000,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  return Array.isArray(parsed.questions) ? parsed.questions.slice(0, 5) : [];
};

/**
 * Evaluate candidate's interview answers using AI
 */
const evaluateInterviewAnswers = async (questions, answers, job) => {
  const systemPrompt = `You are an expert HR interviewer evaluating candidate responses. Be fair but thorough. Always respond with valid JSON only.`;

  const qaPairs = questions
    .map(
      (q, i) =>
        `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i] || "(No answer provided)"}`
    )
    .join("\n\n");

  const userPrompt = `Evaluate these interview answers for the following role.

=== JOB DETAILS ===
Title: ${job.title}
Required Skills: ${job.requiredSkills.join(", ")}
Experience Level: ${job.experienceLevel}

=== INTERVIEW Q&A ===
${qaPairs}

=== REQUIRED JSON FORMAT ===
{
  "evaluation": [
    {
      "question": "the question text",
      "answer": "the answer text",
      "score": number (0-100),
      "feedback": "1-2 sentence evaluation of this specific answer"
    }
  ],
  "overallScore": number (0-100, weighted average),
  "aiSummary": "2-3 sentence overall assessment of the candidate's interview performance",
  "strengths": ["strength1", "strength2"],
  "improvements": ["area1", "area2"]
}

Scoring Guidelines:
- 0-20: No answer or completely irrelevant
- 21-40: Vague or mostly incorrect
- 41-60: Partial understanding, lacks depth
- 61-80: Good answer with reasonable depth
- 81-100: Excellent, detailed, and well-structured answer
- Empty or very short answers (< 10 words) should score below 20`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0].message.content);

  const clamp = (val) => Math.min(100, Math.max(0, parseFloat(val) || 0));

  return {
    evaluation: Array.isArray(parsed.evaluation)
      ? parsed.evaluation.map((e) => ({
          question: e.question || "",
          answer: e.answer || "",
          score: clamp(e.score),
          feedback: e.feedback || "",
        }))
      : [],
    overallScore: clamp(parsed.overallScore),
    aiSummary: parsed.aiSummary || "",
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements
      : [],
  };
};

module.exports = { generateInterviewQuestions, evaluateInterviewAnswers };
