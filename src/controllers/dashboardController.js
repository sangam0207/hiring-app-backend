const prisma = require("../config/prisma");
const { successResponse, errorResponse } = require("../utils/response");

// GET /api/dashboard/hr - HR dashboard overview
const getHRDashboard = async (req, res, next) => {
  try {
    const hrId = req.user.id;

    // Parallel queries for performance
    const [
      jobStats,
      recentApplications,
      topCandidates,
      applicationStatusBreakdown,
      recentJobs,
    ] = await Promise.all([
      // Job statistics
      prisma.job.groupBy({
        by: ["status"],
        where: { hrId },
        _count: { status: true },
      }),

      // Recent applications across all HR's jobs
      prisma.application.findMany({
        where: {
          job: { hrId },
        },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          candidate: { select: { id: true, name: true, email: true } },
          job: { select: { id: true, title: true } },
          parsedResume: {
            select: {
              overallScore: true,
              isRecommended: true,
              skillMatchScore: true,
            },
          },
        },
      }),

      // Top recommended candidates
      prisma.parsedResume.findMany({
        where: {
          isRecommended: true,
          application: { job: { hrId } },
        },
        take: 5,
        orderBy: { overallScore: "desc" },
        include: {
          application: {
            include: {
              candidate: { select: { id: true, name: true, email: true } },
              job: { select: { id: true, title: true } },
            },
          },
        },
      }),

      // Application status breakdown
      prisma.application.groupBy({
        by: ["status"],
        where: { job: { hrId } },
        _count: { status: true },
      }),

      // Recent jobs with application counts
      prisma.job.findMany({
        where: { hrId },
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { applications: true } },
        },
      }),
    ]);

    // Calculate totals
    const totalJobs = jobStats.reduce((sum, s) => sum + s._count.status, 0);
    const totalApplications = applicationStatusBreakdown.reduce(
      (sum, s) => sum + s._count.status,
      0
    );

    const jobStatusMap = {};
    jobStats.forEach((s) => {
      jobStatusMap[s.status] = s._count.status;
    });

    const appStatusMap = {};
    applicationStatusBreakdown.forEach((s) => {
      appStatusMap[s.status] = s._count.status;
    });

    return successResponse(res, {
      overview: {
        totalJobs,
        activeJobs: jobStatusMap.ACTIVE || 0,
        draftJobs: jobStatusMap.DRAFT || 0,
        closedJobs: jobStatusMap.CLOSED || 0,
        totalApplications,
        pendingReview: (appStatusMap.APPLIED || 0) + (appStatusMap.SCREENING || 0),
        shortlisted: appStatusMap.SHORTLISTED || 0,
        selected: appStatusMap.SELECTED || 0,
        rejected: appStatusMap.REJECTED || 0,
      },
      applicationStatusBreakdown: appStatusMap,
      recentJobs,
      recentApplications,
      topCandidates,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/hr/jobs/:jobId/report - Detailed job report
const getJobReport = async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        _count: { select: { applications: true } },
      },
    });

    if (!job) return errorResponse(res, "Job not found.", 404);
    if (job.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    const [
      applications,
      statusBreakdown,
      scoreStats,
      skillsFrequency,
    ] = await Promise.all([
      // All applications ranked by score
      prisma.application.findMany({
        where: { jobId },
        orderBy: { parsedResume: { overallScore: "desc" } },
        include: {
          candidate: { select: { id: true, name: true, email: true } },
          parsedResume: {
            select: {
              overallScore: true,
              skillMatchScore: true,
              experienceScore: true,
              matchScore: true,
              extractedSkills: true,
              totalExperience: true,
              currentRole: true,
              isRecommended: true,
              aiSummary: true,
              strengths: true,
              gaps: true,
            },
          },
        },
      }),

      // Status breakdown
      prisma.application.groupBy({
        by: ["status"],
        where: { jobId },
        _count: { status: true },
      }),

      // Average scores
      prisma.parsedResume.aggregate({
        where: { application: { jobId } },
        _avg: {
          overallScore: true,
          skillMatchScore: true,
          experienceScore: true,
        },
        _max: { overallScore: true },
        _min: { overallScore: true },
        _count: { id: true },
      }),

      // Most common skills among applicants
      prisma.parsedResume.findMany({
        where: { application: { jobId } },
        select: { extractedSkills: true },
      }),
    ]);

    // Compute skill frequency
    const skillCount = {};
    skillsFrequency.forEach(({ extractedSkills }) => {
      extractedSkills.forEach((skill) => {
        skillCount[skill] = (skillCount[skill] || 0) + 1;
      });
    });
    const topSkills = Object.entries(skillCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([skill, count]) => ({ skill, count }));

    const statusMap = {};
    statusBreakdown.forEach((s) => {
      statusMap[s.status] = s._count.status;
    });

    return successResponse(res, {
      job,
      summary: {
        total: applications.length,
        recommended: applications.filter((a) => a.parsedResume?.isRecommended).length,
        avgScore: Math.round(scoreStats._avg.overallScore || 0),
        avgSkillMatch: Math.round(scoreStats._avg.skillMatchScore || 0),
        avgExperienceMatch: Math.round(scoreStats._avg.experienceScore || 0),
        highestScore: scoreStats._max.overallScore || 0,
        lowestScore: scoreStats._min.overallScore || 0,
        parsedCount: scoreStats._count.id,
      },
      statusBreakdown: statusMap,
      topSkillsAmongApplicants: topSkills,
      rankedCandidates: applications,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getHRDashboard, getJobReport };
