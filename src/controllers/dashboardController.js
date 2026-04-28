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
      0,
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
        pendingReview:
          (appStatusMap.APPLIED || 0) + (appStatusMap.SCREENING || 0),
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
    if (job.hrId !== req.user.id)
      return errorResponse(res, "Access denied.", 403);

    const [applications, statusBreakdown, scoreStats, skillsFrequency] =
      await Promise.all([
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
        recommended: applications.filter((a) => a.parsedResume?.isRecommended)
          .length,
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

// GET /api/dashboard/candidate - Candidate insights dashboard
const getCandidateDashboard = async (req, res, next) => {
  try {
    const candidateId = req.user.id;
    const profileQuery = prisma.profile?.findFirst
      ? prisma.profile.findFirst({
          where: { userId: candidateId },
          select: { skills: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : Promise.resolve({ skills: [] });

    const [applications, profile] = await Promise.all([
      prisma.application.findMany({
        where: { candidateId },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              requiredSkills: true,
              hr: { select: { company: true } },
            },
          },
          parsedResume: {
            select: {
              overallScore: true,
              skillMatchScore: true,
              experienceScore: true,
              matchScore: true,
              screeningScore: true,
              extractedSkills: true,
              gaps: true,
              strengths: true,
              isRecommended: true,
              parsedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      profileQuery,
    ]);

    const total = applications.length;
    const selected = applications.filter((a) => a.status === "SELECTED").length;
    const rejected = applications.filter((a) => a.status === "REJECTED").length;
    const interviewed = applications.filter((a) =>
      ["INTERVIEW_SCHEDULED", "INTERVIEWED", "SELECTED"].includes(a.status),
    ).length;
    const withScores = applications.filter(
      (a) => a.parsedResume?.overallScore != null,
    );
    const avgScore =
      withScores.length > 0
        ? Math.round(
            withScores.reduce((s, a) => s + a.parsedResume.overallScore, 0) /
              withScores.length,
          )
        : 0;

    // Status breakdown
    const statusBreakdown = {};
    applications.forEach((a) => {
      statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1;
    });

    // Score trend (last 10 apps with scores)
    const scoreTrend = withScores
      .slice(0, 10)
      .reverse()
      .map((a) => ({
        job: a.job?.title?.slice(0, 20) || "Job",
        company: a.job?.hr?.company || "",
        overall: Math.round(a.parsedResume.overallScore),
        skills: Math.round(a.parsedResume.skillMatchScore || 0),
        experience: Math.round(a.parsedResume.experienceScore || 0),
        date: a.parsedResume.parsedAt,
      }));

    // Skill gap analysis: recurring gaps from rejections
    const gapCount = {};
    applications
      .filter((a) => a.status === "REJECTED" && a.parsedResume?.gaps?.length)
      .forEach((a) => {
        a.parsedResume.gaps.forEach((g) => {
          gapCount[g] = (gapCount[g] || 0) + 1;
        });
      });
    const topGaps = Object.entries(gapCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([gap, count]) => ({ gap, count }));

    // Profile match: candidate skills vs most demanded skills
    const demandCount = {};
    applications.forEach((a) => {
      a.job?.requiredSkills?.forEach((s) => {
        demandCount[s] = (demandCount[s] || 0) + 1;
      });
    });
    const topDemanded = Object.entries(demandCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([skill, demand]) => ({
        skill,
        demand,
        hasIt: (profile?.skills || []).some(
          (us) => us.toLowerCase() === skill.toLowerCase(),
        ),
      }));

    return successResponse(res, {
      overview: {
        totalApplications: total,
        selectionRate: total > 0 ? Math.round((selected / total) * 100) : 0,
        avgAIScore: avgScore,
        interviewRate: total > 0 ? Math.round((interviewed / total) * 100) : 0,
        selected,
        rejected,
        interviewed,
      },
      statusBreakdown,
      scoreTrend,
      topGaps,
      profileMatch: topDemanded,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getHRDashboard, getJobReport, getCandidateDashboard };
