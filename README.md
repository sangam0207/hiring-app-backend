# AI-Powered Hiring Platform — Backend

Node.js + Express + Prisma + PostgreSQL + OpenAI

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your actual values:
# - DATABASE_URL (PostgreSQL connection string)
# - OPENAI_API_KEY (your OpenAI key)
# - JWT_SECRET (any long random string)
```

### 3. Setup Database
```bash
npx prisma generate       # Generate Prisma client
npx prisma migrate dev    # Run migrations (creates tables)
# OR
npx prisma db push        # Push schema without migrations
```

### 4. Start the Server
```bash
npm run dev   # Development (nodemon)
npm start     # Production
```

Server runs at: `http://localhost:5000`

---

## 📁 Project Structure

```
src/
├── config/
│   ├── prisma.js          # Prisma client singleton
│   ├── openai.js          # OpenAI client
│   └── multer.js          # File upload config
├── controllers/
│   ├── authController.js       # Register, Login, Profile
│   ├── jobController.js        # Job CRUD + status
│   ├── applicationController.js # Apply, parse, manage
│   └── dashboardController.js  # HR dashboard + reports
├── middleware/
│   ├── auth.js            # JWT authentication
│   └── errorHandler.js    # Global error handler
├── routes/
│   └── index.js           # All routes
├── services/
│   └── resumeParserService.js  # OpenAI resume parsing
└── utils/
    ├── resumeExtractor.js # PDF/DOCX text extraction
    └── response.js        # API response helpers
prisma/
└── schema.prisma          # Database schema
```

---

## 📡 API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register HR or Candidate | Public |
| POST | `/api/auth/login` | Login | Public |
| GET | `/api/auth/me` | Get profile | Any |
| PUT | `/api/auth/me` | Update profile | Any |

**Register Body:**
```json
{
  "email": "hr@company.com",
  "password": "secret123",
  "name": "John HR",
  "role": "HR",          // "HR" or "CANDIDATE"
  "company": "Acme Inc"  // Required if role = HR
}
```

---

### Jobs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/jobs` | Create job | HR |
| GET | `/api/jobs` | List jobs | Any |
| GET | `/api/jobs/:id` | Get job details | Any |
| PUT | `/api/jobs/:id` | Update job | HR (owner) |
| DELETE | `/api/jobs/:id` | Delete job | HR (owner) |
| PATCH | `/api/jobs/:id/status` | Update status | HR (owner) |

**Create Job Body:**
```json
{
  "title": "Senior Backend Developer",
  "description": "We are looking for...",
  "requirements": "Must have 5+ years experience...",
  "requiredSkills": ["Node.js", "PostgreSQL", "Docker"],
  "experienceLevel": "SENIOR",   // ENTRY, JUNIOR, MID, SENIOR, LEAD
  "location": "Remote",
  "salary": "$80k - $100k",
  "jobType": "Full-time",
  "status": "ACTIVE"             // DRAFT, ACTIVE, PAUSED, CLOSED
}
```

**Update Status Body:**
```json
{ "status": "CLOSED" }
```

---

### Applications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/applications/:jobId/apply` | Apply to job (with resume) | Candidate |
| GET | `/api/applications/my` | My applications | Candidate |
| GET | `/api/applications/job/:jobId` | All applicants for job | HR |
| GET | `/api/applications/:id` | Application details | HR/Owner |
| PATCH | `/api/applications/:id/status` | Update status | HR |
| POST | `/api/applications/:id/parse` | Re-parse resume | HR |

**Apply (multipart/form-data):**
```
resume: <file>         // PDF, DOC, DOCX — max 10MB
coverLetter: "string"  // optional
```

**Query Params for job applicants:**
```
?page=1&limit=10
&status=SHORTLISTED         // APPLIED, SCREENING, SHORTLISTED, etc.
&sortBy=overallScore        // or createdAt
&sortOrder=desc
```

---

### Dashboard

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/dashboard/hr` | HR overview + stats | HR |
| GET | `/api/dashboard/hr/jobs/:jobId/report` | Full job report | HR |

**HR Dashboard Response includes:**
- Job counts (active, draft, closed)
- Application pipeline counts
- Recent applications
- Top recommended candidates
- Status breakdown

**Job Report Response includes:**
- All candidates ranked by AI score
- Average scores across applicants
- Common skills among applicants
- Status breakdown

---

## 🤖 Resume Parsing Flow

1. Candidate submits application with PDF/DOCX resume
2. Application is created immediately → response returned
3. **Background process starts:**
   - PDF/DOCX text is extracted
   - Text is sent to OpenAI `gpt-4o-mini` with job context
   - OpenAI returns structured JSON with:
     - Extracted skills, experience, education
     - Match scores (0-100) for skills, experience, overall
     - Strengths and gaps vs job requirements
     - AI summary and recommendation note
4. Results saved to `parsed_resumes` table
5. Application auto-moves to `SHORTLISTED` if score ≥ 65

**HR can re-trigger parsing:**
```
POST /api/applications/:id/parse
```

---

## 🗄️ Database Models

- **User** — HR and Candidate accounts
- **Job** — Job postings with skills + requirements
- **Application** — Candidate → Job applications + resume file
- **ParsedResume** — OpenAI analysis results + scores

---

## 🔐 Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token expiry (default: 7d) |
| `OPENAI_API_KEY` | OpenAI API key |
| `PORT` | Server port (default: 5000) |
| `UPLOAD_DIR` | Resume upload directory (default: uploads) |
| `MAX_FILE_SIZE` | Max file size in bytes (default: 10MB) |
| `FRONTEND_URL` | Frontend URL for CORS |
