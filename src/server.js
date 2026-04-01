require("dotenv").config();
const app = require("./app");
const prisma = require("./config/prisma");

const PORT = process.env.PORT;

const startServer = async () => {
  try {
    // Test DB connection
    await prisma.$connect();
    console.log("✅ Database connected successfully.");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📘 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`\n📋 Available Routes:`);
      console.log(`   POST   /api/auth/register`);
      console.log(`   POST   /api/auth/login`);
      console.log(`   GET    /api/auth/me`);
      console.log(`   PUT    /api/auth/me`);
      console.log(`   POST   /api/jobs                     (HR only)`);
      console.log(`   GET    /api/jobs                     (all authenticated)`);
      console.log(`   GET    /api/jobs/:id`);
      console.log(`   PUT    /api/jobs/:id                 (HR only)`);
      console.log(`   DELETE /api/jobs/:id                 (HR only)`);
      console.log(`   PATCH  /api/jobs/:id/status          (HR only)`);
      console.log(`   POST   /api/applications/:jobId/apply (Candidate only)`);
      console.log(`   GET    /api/applications/my           (Candidate only)`);
      console.log(`   GET    /api/applications/job/:jobId   (HR only)`);
      console.log(`   GET    /api/applications/:id`);
      console.log(`   PATCH  /api/applications/:id/status   (HR only)`);
      console.log(`   POST   /api/applications/:id/parse    (HR only)`);
      console.log(`   GET    /api/dashboard/hr              (HR only)`);
      console.log(`   GET    /api/dashboard/hr/jobs/:id/report (HR only)`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

startServer();
