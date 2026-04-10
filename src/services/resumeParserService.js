const openai = require("../config/openai");

/**
 * Parse resume text using OpenAI and match against job requirements
 * Returns structured candidate data + matching scores
 */
const parseResumeWithAI = async (resumeText, job, screeningAnswers = null) => {
  const systemPrompt = `You are an expert HR analyst and resume parser. Your job is to:
1. Extract structured information from resumes
2. Analyze the candidate's fit for a specific job
3. Provide matching scores and insights

Always respond with valid JSON only. No markdown, no explanation outside JSON.`;

  const screeningSection = screeningAnswers?.length > 0
    ? `\n=== SCREENING ANSWERS ===\n${screeningAnswers.map((qa, i) => `Q${i+1}: ${qa.question}\nA${i+1}: ${qa.answer}`).join("\n\n")}\n`
    : "";

  const userPrompt = `Analyze this resume against the job requirements and return a JSON object.

=== JOB DETAILS ===
Title: ${job.title}
Description: ${job.description}
Requirements: ${job.requirements}
Required Skills: ${job.requiredSkills.join(", ")}
Experience Level: ${job.experienceLevel}

=== RESUME TEXT ===
${resumeText}
${screeningSection}
=== REQUIRED JSON RESPONSE FORMAT ===
{
  "candidateName": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "summary": "brief professional summary of the candidate (2-3 sentences)",

  "extractedSkills": ["skill1", "skill2", ...],
  "totalExperience": number (in years, e.g. 3.5),
  "currentRole": "most recent job title or null",

  "education": [
    {
      "degree": "string",
      "institution": "string",
      "year": "string or null",
      "field": "string or null"
    }
  ],

  "workExperience": [
    {
      "company": "string",
      "role": "string",
      "duration": "string (e.g. Jan 2021 - Dec 2023)",
      "description": "string"
    }
  ],

  "projects": [
    {
      "name": "string",
      "description": "string",
      "technologies": ["tech1", "tech2"]
    }
  ],

  "certifications": ["cert1", "cert2"],
  "languages": ["English", "Hindi"],

  "matchScore": number (0-100, overall match percentage),
  "skillMatchScore": number (0-100, how well skills match required skills),
  "experienceScore": number (0-100, how experience level matches),
  "screeningScore": number or null (0-100, quality of screening answers — null if no screening answers provided),
  "screeningEvaluation": [{"question": "...", "answer": "...", "rating": "good/average/poor", "remark": "brief evaluation"}] or null,
  "overallScore": number (0-100, weighted final score),

  "strengths": ["strength1", "strength2", "strength3"],
  "gaps": ["gap1", "gap2"],
  "aiSummary": "2-3 sentence summary of the candidate's fit for this specific role",
  "recommendationNote": "HR recommendation note - should we proceed with this candidate and why",
  "isRecommended": boolean (true if overallScore >= 65)
}

Scoring Guidelines:
- skillMatchScore: Count how many required skills the candidate has vs total required skills
- experienceScore: Rate based on required experience level (ENTRY=0-1yr, JUNIOR=1-3yr, MID=3-5yr, SENIOR=5-8yr, LEAD=8+yr)
- matchScore: Combination of skills, experience, and relevance
- screeningScore: Evaluate screening answers for quality, relevance, and honesty. Rate salary expectations reasonableness, notice period, and role-specific answers. null if no screening answers.
- overallScore: Weighted average — if screening answers exist: (skills 30%, experience 25%, match 25%, screening 20%). Otherwise: (skills 40%, experience 30%, match 30%)
- isRecommended: true if overallScore >= 65`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1, // Low temperature for consistent structured output
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);

  // Validate and sanitize scores (ensure they're 0-100)
  const clamp = (val) =>
    Math.min(100, Math.max(0, parseFloat(val) || 0));

  return {
    candidateName: parsed.candidateName || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    location: parsed.location || null,
    summary: parsed.summary || null,
    extractedSkills: Array.isArray(parsed.extractedSkills)
      ? parsed.extractedSkills
      : [],
    totalExperience:
      parseFloat(parsed.totalExperience) || null,
    currentRole: parsed.currentRole || null,
    education: Array.isArray(parsed.education) ? parsed.education : [],
    workExperience: Array.isArray(parsed.workExperience)
      ? parsed.workExperience
      : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    certifications: Array.isArray(parsed.certifications)
      ? parsed.certifications
      : [],
    languages: Array.isArray(parsed.languages) ? parsed.languages : [],
    matchScore: clamp(parsed.matchScore),
    skillMatchScore: clamp(parsed.skillMatchScore),
    experienceScore: clamp(parsed.experienceScore),
    screeningScore: parsed.screeningScore != null ? clamp(parsed.screeningScore) : null,
    screeningEvaluation: Array.isArray(parsed.screeningEvaluation) ? parsed.screeningEvaluation : null,
    overallScore: clamp(parsed.overallScore),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
    aiSummary: parsed.aiSummary || null,
    recommendationNote: parsed.recommendationNote || null,
    isRecommended: Boolean(parsed.isRecommended),
  };
};

/**
 * Parse resume text for profile auto-fill (no job matching, just extraction)
 */
const parseProfileFromResume = async (resumeText) => {
  const systemPrompt = `You are an expert resume parser. Extract structured information from resumes. Always respond with valid JSON only. No markdown, no explanation outside JSON.`;

  const userPrompt = `Extract all structured information from this resume and return a JSON object.

=== RESUME TEXT ===
${resumeText}

=== REQUIRED JSON RESPONSE FORMAT ===
{
  "name": "full name",
  "phone": "phone number or null",
  "headline": "professional headline (e.g. 'Senior React Developer with 5+ years experience')",
  "summary": "professional summary (2-4 sentences)",
  "location": "city, country or null",
  "currentCompany": "most recent company or null",
  "currentRole": "most recent job title or null",
  "totalExperience": number (years, e.g. 3.5),
  "skills": ["skill1", "skill2", ...],
  "education": [{"degree": "string", "institution": "string", "year": "string or null", "field": "string or null"}],
  "workExperience": [{"company": "string", "role": "string", "duration": "string (e.g. Jan 2021 - Dec 2023)", "description": "string"}],
  "certifications": ["cert1", "cert2"],
  "languages": ["English", "Hindi"]
}

Extract as much as possible. If a field is not found, use null or empty array.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0].message.content);

  return {
    name: parsed.name || null,
    phone: parsed.phone || null,
    headline: parsed.headline || null,
    summary: parsed.summary || null,
    location: parsed.location || null,
    currentCompany: parsed.currentCompany || null,
    currentRole: parsed.currentRole || null,
    totalExperience: parseFloat(parsed.totalExperience) || null,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
    workExperience: Array.isArray(parsed.workExperience) ? parsed.workExperience : [],
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
    languages: Array.isArray(parsed.languages) ? parsed.languages : [],
  };
};

module.exports = { parseResumeWithAI, parseProfileFromResume };
