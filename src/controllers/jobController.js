const prisma = require("../config/prisma");
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

module.exports = {
  createJob,
  getJobs,
  getJobById,
  getJobFilters,
  updateJob,
  deleteJob,
  updateJobStatus,
};
