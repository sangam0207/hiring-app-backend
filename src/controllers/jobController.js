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
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // HR sees their own jobs; candidates see ACTIVE jobs
    const isHR = req.user?.role === "HR";

    const where = {
      ...(isHR ? { hrId: req.user.id } : { status: "ACTIVE" }),
      ...(status && isHR && { status }),
      ...(experienceLevel && { experienceLevel }),
      ...(jobType && { jobType }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { requiredSkills: { has: search } },
        ],
      }),
    };

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

module.exports = {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  updateJobStatus,
};
