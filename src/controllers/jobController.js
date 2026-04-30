const prisma = require("../config/prisma");
const openai = require("../config/openai");
const { successResponse, errorResponse, paginatedResponse } = require("../utils/response");

// POST /api/jobs - HR creates a job
const createJob = async (req, res, next) => {
  try {
    const {
      title,
      description,
      requirements,
      requiredSkills,
      experienceLevel,
      location,
      salary,
      jobType,
      status,
    } = req.body;

    if (!title || !description || !requirements || !requiredSkills || !experienceLevel) {
      return errorResponse(res, "Title, description, requirements, requiredSkills, and experienceLevel are required.");
    }

    const validLevels = ["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"];
    if (!validLevels.includes(experienceLevel)) {
      return errorResponse(res, `experienceLevel must be one of: ${validLevels.join(", ")}`);
    }

    const job = await prisma.job.create({
      data: {
        title,
        description,
        requirements,
        requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : [requiredSkills],
        experienceLevel,
        location: location || null,
        salary: salary || null,
        jobType: jobType || null,
        status: status || "DRAFT",
        hrId: req.user.id,
      },
      include: {
        hr: {
          select: { id: true, name: true, company: true, email: true },
        },
        _count: { select: { applications: true } },
      },
    });

    return successResponse(res, { job }, "Job created successfully.", 201);
  } catch (error) {
    next(error);
  }
};

// GET /api/jobs - Public - list active jobs (candidates) or all HR's jobs
const getJobs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      experienceLevel,
      status,
      jobType,
      datePosted,
      company,
      location,
      applicants,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // HR sees their own jobs; candidates see ACTIVE jobs
    const isHR = req.user?.role === "HR";

    // Date posted filter
    let dateFilter = {};
    if (datePosted) {
      const now = new Date();
      if (datePosted === "24h")
        dateFilter = { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } };
      else if (datePosted === "week")
        dateFilter = { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } };
      else if (datePosted === "month")
        dateFilter = { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } };
    }

    const where = {
      ...(isHR ? { hrId: req.user.id } : { status: "ACTIVE" }),
      ...(status && isHR && { status }),
      ...(experienceLevel && { experienceLevel }),
      ...(jobType && { jobType }),
      ...dateFilter,
      ...(location && { location: { contains: location, mode: "insensitive" } }),
      ...(company && { hr: { company: { contains: company, mode: "insensitive" } } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { requiredSkills: { has: search } },
        ],
      }),
    };

    // If applicants filter is active, use two-pass approach (filter by count)
    if (applicants) {
      let minApp = 0, maxApp = Infinity;
      if (applicants === "0") { minApp = 0; maxApp = 0; }
      else if (applicants === "1-10") { minApp = 1; maxApp = 10; }
      else if (applicants === "11-50") { minApp = 11; maxApp = 50; }
      else if (applicants === "50+") { minApp = 51; }

      const allJobs = await prisma.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: { id: true, _count: { select: { applications: true } } },
      });

      const filteredIds = allJobs
        .filter(j => j._count.applications >= minApp && j._count.applications <= maxApp)
        .map(j => j.id);

      const total = filteredIds.length;
      const paginatedIds = filteredIds.slice(skip, skip + take);

      const jobs = paginatedIds.length > 0
        ? await prisma.job.findMany({
            where: { id: { in: paginatedIds } },
            orderBy: { createdAt: "desc" },
            include: {
              hr: { select: { id: true, name: true, company: true } },
              _count: { select: { applications: true } },
            },
          })
        : [];

      return paginatedResponse(res, { jobs }, {
        total,
        page: parseInt(page),
        limit: take,
        totalPages: Math.ceil(total / take),
      });
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          hr: { select: { id: true, name: true, company: true } },
          _count: { select: { applications: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);

    return paginatedResponse(res, { jobs }, {
      total,
      page: parseInt(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/jobs/:id
const getJobById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        hr: { select: { id: true, name: true, company: true, email: true } },
        _count: { select: { applications: true } },
      },
    });

    if (!job) {
      return errorResponse(res, "Job not found.", 404);
    }

    // HR can only see their own jobs
    if (req.user?.role === "HR" && job.hrId !== req.user.id) {
      return errorResponse(res, "Access denied.", 403);
    }

    return successResponse(res, { job });
  } catch (error) {
    next(error);
  }
};

// PUT /api/jobs/:id - HR updates job
const updateJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      requirements,
      requiredSkills,
      experienceLevel,
      location,
      salary,
      jobType,
      status,
    } = req.body;

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, "Job not found.", 404);
    }

    if (existing.hrId !== req.user.id) {
      return errorResponse(res, "Access denied. You can only edit your own jobs.", 403);
    }

    const validStatuses = ["DRAFT", "ACTIVE", "PAUSED", "CLOSED"];
    if (status && !validStatuses.includes(status)) {
      return errorResponse(res, `Status must be one of: ${validStatuses.join(", ")}`);
    }

    const job = await prisma.job.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(requirements && { requirements }),
        ...(requiredSkills && {
          requiredSkills: Array.isArray(requiredSkills)
            ? requiredSkills
            : [requiredSkills],
        }),
        ...(experienceLevel && { experienceLevel }),
        ...(location !== undefined && { location }),
        ...(salary !== undefined && { salary }),
        ...(jobType !== undefined && { jobType }),
        ...(status && { status }),
      },
      include: {
        hr: { select: { id: true, name: true, company: true } },
        _count: { select: { applications: true } },
      },
    });

    return successResponse(res, { job }, "Job updated successfully.");
  } catch (error) {
    next(error);
  }
};

// DELETE /api/jobs/:id - HR deletes a job
const deleteJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, "Job not found.", 404);
    }

    if (existing.hrId !== req.user.id) {
      return errorResponse(res, "Access denied.", 403);
    }

    await prisma.job.delete({ where: { id } });

    return successResponse(res, null, "Job deleted successfully.");
  } catch (error) {
    next(error);
  }
};

// PATCH /api/jobs/:id/status - HR updates job status only
const updateJobStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["DRAFT", "ACTIVE", "PAUSED", "CLOSED"];
    if (!validStatuses.includes(status)) {
      return errorResponse(res, `Status must be one of: ${validStatuses.join(", ")}`);
    }

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, "Job not found.", 404);
    if (existing.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    const job = await prisma.job.update({
      where: { id },
      data: { status },
      include: {
        _count: { select: { applications: true } },
      },
    });

    return successResponse(res, { job }, `Job status updated to ${status}.`);
  } catch (error) {
    next(error);
  }
};

// GET /api/jobs/filters - returns distinct companies for filter dropdowns
const getJobFilters = async (req, res, next) => {
  try {
    const isHR = req.user?.role === "HR";
    const where = isHR ? { hrId: req.user.id } : { status: "ACTIVE" };

    const jobs = await prisma.job.findMany({
      where,
      select: { hr: { select: { company: true } } },
    });

    const companies = [...new Set(jobs.map(j => j.hr?.company).filter(Boolean))].sort();

    return successResponse(res, { companies });
  } catch (error) {
    next(error);
  }
};

// GET /api/jobs/:jobId/screening-questions - Generate/return screening questions for a job
const getScreeningQuestions = async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return errorResponse(res, "Job not found.", 404);

    // Return cached questions if they exist
    if (job.screeningQuestions && Array.isArray(job.screeningQuestions) && job.screeningQuestions.length > 0) {
      return successResponse(res, { questions: job.screeningQuestions });
    }

    // Fixed standard HR questions
    const fixedQuestions = [
      { id: "q1", question: "What is your current CTC / salary (in LPA)?", type: "fixed", inputType: "text" },
      { id: "q2", question: "What is your expected CTC / salary (in LPA)?", type: "fixed", inputType: "text" },
      { id: "q3", question: "What is your notice period (in days)?", type: "fixed", inputType: "text" },
    ];

    // Generate role-specific questions via OpenAI
    let aiQuestions = [];
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert HR recruiter. Generate screening questions for job applicants. Return JSON only.",
          },
          {
            role: "user",
            content: `Generate exactly 2 short screening questions for this job posting. Questions should be specific to the role and help HR quickly assess candidate fit.

Job Title: ${job.title}
Description: ${job.description?.slice(0, 500)}
Required Skills: ${job.requiredSkills.join(", ")}
Experience Level: ${job.experienceLevel}

Return JSON in this format:
{
  "questions": [
    { "question": "...", "inputType": "textarea" },
    { "question": "...", "inputType": "textarea" }
  ]
}

Keep questions concise (1 sentence each). Focus on motivation, relevant experience, or key skills.`,
          },
        ],
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        aiQuestions = parsed.questions.slice(0, 2).map((q, i) => ({
          id: `ai${i + 1}`,
          question: q.question,
          type: "ai",
          inputType: q.inputType || "textarea",
        }));
      }
    } catch (err) {
      console.error("[Screening] OpenAI error:", err.message);
      // Fallback AI questions if OpenAI fails
      aiQuestions = [
        { id: "ai1", question: "Why are you interested in this role?", type: "ai", inputType: "textarea" },
        { id: "ai2", question: `What relevant experience do you have for the ${job.title} position?`, type: "ai", inputType: "textarea" },
      ];
    }

    const allQuestions = [...fixedQuestions, ...aiQuestions];

    // Cache questions on the job record
    await prisma.job.update({
      where: { id: jobId },
      data: { screeningQuestions: allQuestions },
    });

    return successResponse(res, { questions: allQuestions });
  } catch (error) {
    next(error);
  }
};

// GET /api/jobs/recommended - AI-powered job matching for candidates
const getRecommendedJobs = async (req, res, next) => {
  try {
    // ✅ Get user's DEFAULT profile (IMPORTANT CHANGE)
    const profile = await prisma.profile.findFirst({
      where: {
        userId: req.user.id,
        isDefault: true,
      },
      select: {
        name: true,
        headline: true,
        summary: true,
        skills: true,
        totalExperience: true,
        currentRole: true,
        currentCompany: true,
        education: true,
        workExperience: true,
        location: true,
      },
    });

    // ❌ If no profile
    if (!profile || (!profile.skills?.length && !profile.headline && !profile.summary)) {
      return errorResponse(
        res,
        "Please complete your profile first (skills, headline) for AI matching.",
        400
      );
    }

    // ✅ Get jobs
    const jobs = await prisma.job.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        description: true,
        requirements: true,
        requiredSkills: true,
        experienceLevel: true,
        location: true,
        salary: true,
        jobType: true,
        createdAt: true,
        hr: { select: { company: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    if (!jobs.length) {
      return successResponse(res, { recommendations: [] });
    }

    // ✅ Build profile summary
    const profileSummary = [
      profile.headline && `Headline: ${profile.headline}`,
      profile.currentRole && `Current Role: ${profile.currentRole}`,
      profile.currentCompany && `Current Company: ${profile.currentCompany}`,
      profile.totalExperience && `Experience: ${profile.totalExperience} years`,
      profile.skills?.length && `Skills: ${profile.skills.join(", ")}`,
      profile.location && `Location: ${profile.location}`,
      profile.summary && `Summary: ${profile.summary.slice(0, 300)}`,
    ]
      .filter(Boolean)
      .join("\n");

    // ✅ Jobs list for AI
    const jobsList = jobs
      .map(
        (j, i) =>
          `[${i}] "${j.title}" at ${j.hr?.company || "Unknown"} | Skills: ${j.requiredSkills.join(", ")} | Level: ${j.experienceLevel} | ${j.location || "Remote"}`
      )
      .join("\n");

    // ✅ AI call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert job matching AI. Match candidates to jobs based on skills, experience, and career trajectory. Return JSON only.",
        },
        {
          role: "user",
          content: `Match this candidate profile against the job listings.

=== CANDIDATE PROFILE ===
${profileSummary}

=== AVAILABLE JOBS ===
${jobsList}

Return JSON:
{
  "matches": [
    { "index": number, "matchPercent": number, "reason": "short reason" }
  ]
}

Rules:
- Max 6 jobs
- matchPercent >= 40
- Sort by matchPercent desc
- Be realistic`,
        },
      ],
    });

    // ✅ Safe parse
    let parsed;
    try {
      parsed = JSON.parse(response.choices[0].message.content);
    } catch (err) {
      console.error("AI JSON Parse Error:", err.message);
      return successResponse(res, { recommendations: [] });
    }

    const matches = (parsed.matches || [])
      .filter(
        (m) =>
          m.index >= 0 &&
          m.index < jobs.length &&
          m.matchPercent >= 40
      )
      .sort((a, b) => b.matchPercent - a.matchPercent)
      .slice(0, 6)
      .map((m) => ({
        job: jobs[m.index],
        matchPercent: Math.round(m.matchPercent),
        reason: m.reason,
      }));

    return successResponse(res, { recommendations: matches });
  } catch (error) {
    console.error("[Job Matching] Error:", error.message);
    next(error);
  }
};

module.exports = {
  createJob,
  getJobs,
  getJobById,
  getJobFilters,
  updateJob,
  deleteJob,
  updateJobStatus,
  getScreeningQuestions,
  getRecommendedJobs,
};
