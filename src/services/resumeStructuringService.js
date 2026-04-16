/**
 * resumeStructuringService.js
 *
 * Parse unstructured resume text into structured JSON format
 * suitable for editing in the UI.
 */

const openai = require("../config/openai");

/**
 * Convert raw resume text into structured JSON
 * @param {string} resumeText - Raw text extracted from PDF/file
 * @returns {Promise<Object>} Structured resume data
 */
async function structureResumeFromText(resumeText) {
  if (!resumeText || !resumeText.trim()) {
    throw new Error("Resume text is required");
  }

  const systemPrompt = `You are an expert HR analyst specializing in resume parsing and structuring.
Your task is to extract and organize resume information into a clean, structured JSON format.

CRITICAL RULES:
1. DO NOT hallucinate or add fake information
2. If a field is missing or unclear, return it as null or empty array
3. Keep all text as-is (don't rewrite or improve)
4. Preserve exact text from the resume
5. For multi-line content, preserve original formatting
6. Be conservative - if unsure about a field, leave it empty`;

  const userPrompt = `Parse the following resume text into a structured JSON object.

RESUME TEXT:
===================
${resumeText}
===================

Return ONLY a JSON object (no markdown, no explanation) with this exact structure:

{
  "name": "Full name or null",
  "email": "Email address or null",
  "phone": "Phone number or null",
  "location": "City, State or null",
  "summary": "Professional summary/objective text or null",
  
  "experience": [
    {
      "company": "Company name",
      "jobTitle": "Job title",
      "duration": "Duration description (e.g., 'Jan 2020 - Dec 2022' or '2 years')",
      "description": "Job description and responsibilities"
    }
  ],
  
  "skills": [
    "skill1",
    "skill2"
  ],
  
  "education": [
    {
      "degree": "Degree name (e.g., 'Bachelor of Science')",
      "field": "Field of study or null",
      "institution": "University/College name",
      "year": "Graduation year or date range or null"
    }
  ],
  
  "certifications": [
    {
      "name": "Certification name",
      "issuer": "Issuing organization or null",
      "year": "Year obtained or null"
    }
  ]
}

Guidelines:
- For experience: Extract exact text as written, preserve structure
- For skills: List as individual items (not as comma-separated string)
- For education: Separate each degree/certification entry
- For certifications: Create separate entry for each certification
- Keep text exactly as written - do not improve or rephrase
- Return empty arrays if section is missing
- Return null for missing scalar fields`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const structured = JSON.parse(content);

    // Validate and clean structure
    return sanitizeStructuredResume(structured);
  } catch (error) {
    console.error("[ResumeStructuring] Error parsing resume:", error.message);
    throw new Error(
      "Failed to parse resume. Please check the format and try again.",
    );
  }
}

/**
 * Improve a specific section of the resume
 * @param {string} section - Section name (summary, experience, skills, education, certifications)
 * @param {*} sectionData - Current section data
 * @returns {Promise<*>} Improved section data
 */
async function improveSectionWithAI(section, sectionData, mode = "impactful") {
  if (!section || !sectionData) {
    throw new Error("Section name and data are required");
  }

  const modeGuidance = {
    clarity: "Prioritize clarity and readability.",
    concise: "Make the content concise and remove redundancy.",
    impactful: "Increase impact with strong action-oriented wording.",
    tailor: "Tailor wording to be role-relevant while preserving facts.",
  };
  const activeGuidance = modeGuidance[mode] || modeGuidance.impactful;

  const sectionPrompts = {
    summary: `Improve the following professional summary. Make it more impactful while keeping it concise (3-4 sentences max).
Rules:
- Keep the original tone and information
- Use strong, action-oriented language
- Make it ATS-friendly (no special characters)
- Highlight key value propositions
  - ${activeGuidance}

Current summary:
${sectionData}

Return only the improved summary text (no JSON, no explanation).`,

    experience: `Improve the following job description. Make it more impactful and ATS-friendly.
Rules:
- Use strong action verbs (Managed, Led, Developed, etc.)
- Keep it concise but detailed
- Make achievements clear
- Preserve company name and job title
- Do NOT add fake experience
  - ${activeGuidance}

Current description:
${JSON.stringify(sectionData, null, 2)}

Return a JSON object with the same structure as input, but with improved descriptions. Only return JSON, no explanation.`,

    skills: `Review and categorize the following skills list. Organize skills logically without adding new ones.
Rules:
- Keep all original skills
- Group related skills together
- Reorder for impact (most relevant first)
- Do NOT add skills the person doesn't have
  - ${activeGuidance}

Current skills:
${JSON.stringify(sectionData, null, 2)}

Return an improved array of skills (JSON array format), no explanation.`,

    education: `Review the following education entries. Format them consistently and clearly.
Rules:
- Keep all original information
- Format dates consistently
- Add field of study if missing but obvious
- Do NOT add fake degrees
  - ${activeGuidance}

Current education:
${JSON.stringify(sectionData, null, 2)}

Return improved education array with same structure (JSON format), no explanation.`,

    certifications: `Review the following certifications. Format them clearly and add missing details if obvious.
Rules:
- Keep all original certifications
- Add issuer if missing but obvious
- Format dates consistently
- Do NOT add fake certifications
  - ${activeGuidance}

Current certifications:
${JSON.stringify(sectionData, null, 2)}

Return improved certifications array with same structure (JSON format), no explanation.`,
  };

  const prompt = sectionPrompts[section];
  if (!prompt) {
    throw new Error(`Unsupported section: ${section}`);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const content = response.choices[0].message.content;

    // Parse response - might be JSON or plain text
    try {
      return JSON.parse(content);
    } catch {
      // If not JSON, treat as plain text (for summary improvement)
      return section === "summary" ? content.trim() : sectionData;
    }
  } catch (error) {
    console.error(
      `[ResumeStructuring] Error improving ${section}:`,
      error.message,
    );
    throw new Error(`Failed to improve ${section}. Please try again.`);
  }
}

/**
 * Apply conversational edits to resume data
 * Example: "Make summary shorter" or "Improve my experience"
 * @param {Object} resumeData - Current structured resume
 * @param {string} instruction - User instruction (e.g., "Make summary shorter")
 * @returns {Promise<Object>} Updated resume data
 */
async function applyConversationalEdit(resumeData, instruction) {
  if (!instruction || !instruction.trim()) {
    throw new Error("Instruction is required");
  }

  const systemPrompt = `You are a resume editing AI assistant. The user has given an instruction to modify their resume.
Your task is to:
1. Understand what section they want modified
2. Apply the modification
3. Return ONLY the updated resume as JSON

CRITICAL RULES:
- Do NOT add information that wasn't in the original resume
- Do NOT create fake experience or skills
- Preserve all original information unless explicitly told to remove or modify it
- If instruction is ambiguous, modify the most relevant section`;

  const userPrompt = `Current resume data:
${JSON.stringify(resumeData, null, 2)}

User instruction: "${instruction}"

Apply this instruction to the resume. Return the COMPLETE updated resume as JSON with the same structure.
Only modify relevant sections. Return ONLY JSON, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const updated = JSON.parse(content);

    return sanitizeStructuredResume(updated);
  } catch (error) {
    console.error(
      "[ResumeStructuring] Error applying conversational edit:",
      error.message,
    );
    throw new Error("Failed to apply edit. Please try again.");
  }
}

/**
 * Validate and sanitize structured resume
 */
function sanitizeStructuredResume(data) {
  return {
    name: data.name || null,
    email: data.email || null,
    phone: data.phone || null,
    location: data.location || null,
    summary: data.summary || null,
    experience: Array.isArray(data.experience)
      ? data.experience.map((exp) => ({
          company: exp.company || "",
          jobTitle: exp.jobTitle || "",
          duration: exp.duration || "",
          description: exp.description || "",
        }))
      : [],
    skills: Array.isArray(data.skills) ? data.skills.filter(Boolean) : [],
    education: Array.isArray(data.education)
      ? data.education.map((edu) => ({
          degree: edu.degree || "",
          field: edu.field || null,
          institution: edu.institution || "",
          year: edu.year || null,
        }))
      : [],
    certifications: Array.isArray(data.certifications)
      ? data.certifications.map((cert) => ({
          name: cert.name || "",
          issuer: cert.issuer || null,
          year: cert.year || null,
        }))
      : [],
  };
}

module.exports = {
  structureResumeFromText,
  improveSectionWithAI,
  applyConversationalEdit,
};
