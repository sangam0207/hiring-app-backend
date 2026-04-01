const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

// ─── HR Users (One per industry) ─────────────────────────────────────────────
const hrUsers = [
  { email: "hr@techcorp.com",          password: "password123", name: "Sarah Mitchell",    role: "HR", company: "TechCorp Solutions",            phone: "+1-555-0101" },
  { email: "hr@cityhealth.com",        password: "password123", name: "Dr. Amanda Ross",   role: "HR", company: "City Health Medical Center",     phone: "+1-555-0102" },
  { email: "hr@globalbank.com",        password: "password123", name: "Robert Chen",       role: "HR", company: "Global Bank & Finance",          phone: "+1-555-0103" },
  { email: "hr@brightminds.edu",       password: "password123", name: "Patricia Hall",     role: "HR", company: "BrightMinds Education Group",    phone: "+1-555-0104" },
  { email: "hr@marketpulse.com",       password: "password123", name: "Lisa Nguyen",       role: "HR", company: "MarketPulse Agency",             phone: "+1-555-0105" },
  { email: "hr@lexgroup.com",          password: "password123", name: "David Harrington",  role: "HR", company: "Lex Group Law Firm",             phone: "+1-555-0106" },
  { email: "hr@precisionmfg.com",      password: "password123", name: "Karen Scott",       role: "HR", company: "Precision Manufacturing Co.",    phone: "+1-555-0107" },
  { email: "hr@retailnation.com",      password: "password123", name: "James Okafor",      role: "HR", company: "RetailNation Inc.",              phone: "+1-555-0108" },
  { email: "hr@buildright.com",        password: "password123", name: "Tony Ramirez",      role: "HR", company: "BuildRight Construction",        phone: "+1-555-0109" },
  { email: "hr@greenearthfarms.com",   password: "password123", name: "Emily Watson",      role: "HR", company: "Green Earth Farms",              phone: "+1-555-0110" },
];

// ─── Jobs (All Sectors) ───────────────────────────────────────────────────────
const jobsData = [

  // ══════════════════════════════════════════════════════
  // TECHNOLOGY
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@techcorp.com",
    title: "Senior Full Stack Developer",
    description: `TechCorp Solutions is looking for a Senior Full Stack Developer to design, develop, and maintain scalable web applications used by over 500,000 users worldwide.\n\nYou will collaborate closely with product managers, designers, and backend engineers to deliver high-quality features, mentor junior developers, and contribute to architectural decisions.`,
    requirements: `- 5+ years of professional full-stack development experience\n- Strong proficiency in React.js or Next.js\n- Solid backend experience with Node.js and Express\n- Experience with PostgreSQL or other relational databases\n- Experience with cloud platforms (AWS, GCP, or Azure)\n- Familiarity with Docker and CI/CD pipelines`,
    requiredSkills: ["React.js", "Node.js", "PostgreSQL", "AWS", "Docker", "TypeScript"],
    experienceLevel: "SENIOR",
    location: "San Francisco, CA (Hybrid)",
    salary: "$130,000 - $160,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@techcorp.com",
    title: "Junior Frontend Developer",
    description: `TechCorp Solutions is looking for a Junior Frontend Developer passionate about building beautiful, responsive web interfaces. You will work alongside senior developers on real projects and receive mentorship.\n\nWe believe in learning by doing and will give you the opportunity to own features from day one.`,
    requirements: `- 1+ year of experience or strong portfolio in frontend development\n- Solid knowledge of HTML, CSS, and JavaScript\n- Experience with React.js or willingness to learn quickly\n- Understanding of responsive design and cross-browser compatibility\n- Familiarity with Git version control`,
    requiredSkills: ["HTML", "CSS", "JavaScript", "React.js", "Git", "Tailwind CSS"],
    experienceLevel: "JUNIOR",
    location: "Remote",
    salary: "$55,000 - $75,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@techcorp.com",
    title: "DevOps Engineer",
    description: `We are looking for a DevOps Engineer to build and maintain our cloud infrastructure at TechCorp Solutions. You will ensure the reliability, scalability, and security of our systems, automate deployment pipelines, and manage Kubernetes clusters.`,
    requirements: `- 4+ years of experience in DevOps or SRE\n- Strong experience with AWS services\n- Proficiency with Kubernetes and Docker\n- Experience with CI/CD tools such as GitHub Actions or Jenkins\n- Strong scripting skills in Bash or Python\n- Experience with Terraform or CloudFormation`,
    requiredSkills: ["AWS", "Kubernetes", "Docker", "Terraform", "CI/CD", "Python", "Linux"],
    experienceLevel: "SENIOR",
    location: "Austin, TX (On-site)",
    salary: "$120,000 - $150,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // HEALTHCARE & MEDICAL
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@cityhealth.com",
    title: "Registered Nurse (ICU)",
    description: `City Health Medical Center is seeking a compassionate and experienced Registered Nurse to work in our Intensive Care Unit. You will provide critical care to patients with life-threatening conditions and work as part of a dedicated multidisciplinary team.\n\nYou will assess patient conditions, administer medications, monitor vital signs, and communicate effectively with physicians and families.`,
    requirements: `- Valid Registered Nurse (RN) license in the state\n- Bachelor of Science in Nursing (BSN) preferred\n- 2+ years of ICU or critical care nursing experience\n- BLS and ACLS certification required\n- Strong clinical assessment and critical thinking skills\n- Ability to work rotating shifts including nights and weekends`,
    requiredSkills: ["Critical Care", "Patient Assessment", "ACLS", "BLS", "Ventilator Management", "Medication Administration", "EMR Systems"],
    experienceLevel: "MID",
    location: "Chicago, IL (On-site)",
    salary: "$75,000 - $95,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@cityhealth.com",
    title: "Medical Laboratory Technician",
    description: `City Health Medical Center is hiring a Medical Laboratory Technician to perform a variety of clinical laboratory tests used in the diagnosis, treatment, and prevention of disease.\n\nYou will work in our modern laboratory facility processing specimens, operating analyzers, and ensuring the accuracy and reliability of test results.`,
    requirements: `- Associate's or Bachelor's degree in Medical Laboratory Technology\n- ASCP certification (MLT or MLS) preferred\n- 1+ year of laboratory experience preferred\n- Proficiency in operating laboratory equipment and analyzers\n- Strong attention to detail and ability to follow protocols\n- Knowledge of laboratory safety procedures`,
    requiredSkills: ["Clinical Laboratory", "Specimen Processing", "ASCP Certification", "LIS", "Quality Control", "Hematology", "Microbiology"],
    experienceLevel: "JUNIOR",
    location: "Chicago, IL (On-site)",
    salary: "$45,000 - $60,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@cityhealth.com",
    title: "Healthcare Administrator",
    description: `City Health Medical Center is looking for an experienced Healthcare Administrator to oversee the daily operations of our outpatient clinic division. You will manage staff, budgets, compliance, and operational efficiency across multiple departments.\n\nYou will serve as the liaison between clinical staff, executive leadership, and external partners.`,
    requirements: `- Bachelor's degree in Healthcare Administration or Business (Master's preferred)\n- 5+ years of experience in healthcare administration\n- Strong knowledge of healthcare regulations and HIPAA\n- Experience with budgeting and financial reporting\n- Excellent leadership and people management skills\n- Familiarity with EHR/EMR systems`,
    requiredSkills: ["Healthcare Management", "HIPAA Compliance", "Budget Management", "EHR Systems", "Staff Management", "Operations", "Regulatory Compliance"],
    experienceLevel: "SENIOR",
    location: "Chicago, IL (On-site)",
    salary: "$90,000 - $120,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // FINANCE & BANKING
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@globalbank.com",
    title: "Financial Analyst",
    description: `Global Bank & Finance is seeking a detail-oriented Financial Analyst to join our corporate finance team. You will analyze financial data, build financial models, and provide insights that drive strategic business decisions.\n\nYou will work closely with senior management to prepare forecasts, budgets, and investment analyses.`,
    requirements: `- Bachelor's degree in Finance, Accounting, or Economics\n- 2+ years of experience in financial analysis\n- Strong proficiency in Microsoft Excel and financial modeling\n- Knowledge of accounting principles (GAAP or IFRS)\n- CFA Level 1 or progress toward CFA is a plus\n- Strong analytical and quantitative skills`,
    requiredSkills: ["Financial Modeling", "Excel", "Financial Reporting", "Forecasting", "GAAP", "PowerBI", "Valuation", "Data Analysis"],
    experienceLevel: "JUNIOR",
    location: "New York, NY (Hybrid)",
    salary: "$70,000 - $90,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@globalbank.com",
    title: "Senior Risk Manager",
    description: `Global Bank & Finance is looking for a Senior Risk Manager to identify, assess, and mitigate financial and operational risks across our banking operations. You will develop risk frameworks, conduct risk assessments, and report findings to executive leadership.\n\nThis is a highly visible, strategic role requiring both technical expertise and leadership capability.`,
    requirements: `- 7+ years of experience in risk management within a financial institution\n- Deep knowledge of credit risk, market risk, and operational risk\n- Experience with Basel III/IV regulatory requirements\n- FRM or PRM certification preferred\n- Strong quantitative and statistical analysis skills\n- Experience leading risk committees or board reporting`,
    requiredSkills: ["Risk Management", "Basel III", "Credit Risk", "Market Risk", "FRM Certification", "Regulatory Compliance", "Financial Modeling"],
    experienceLevel: "LEAD",
    location: "New York, NY (On-site)",
    salary: "$140,000 - $175,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@globalbank.com",
    title: "Bank Teller",
    description: `Global Bank & Finance is hiring friendly and reliable Bank Tellers for our retail branch locations. You will be the face of our bank, assisting customers with deposits, withdrawals, and account inquiries.\n\nYou will work in a fast-paced environment where accuracy and professionalism are key. Full training is provided.`,
    requirements: `- High school diploma or equivalent required\n- Previous cash handling or customer service experience preferred\n- Strong numerical accuracy and attention to detail\n- Excellent interpersonal and communication skills\n- Ability to work efficiently in a high-volume environment\n- Basic computer proficiency`,
    requiredSkills: ["Cash Handling", "Customer Service", "Banking Software", "Numerical Accuracy", "Communication", "Teamwork"],
    experienceLevel: "ENTRY",
    location: "Multiple Locations, NY",
    salary: "$35,000 - $45,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // EDUCATION
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@brightminds.edu",
    title: "High School Mathematics Teacher",
    description: `BrightMinds Education Group is seeking a passionate Mathematics Teacher to educate students in Algebra, Geometry, Pre-Calculus, and AP Calculus. You will develop lesson plans, assess student performance, and foster a positive learning environment.\n\nYou will work collaboratively with department colleagues and engage with parents to support student success.`,
    requirements: `- Bachelor's degree in Mathematics or Mathematics Education (Master's preferred)\n- Valid state teaching certification in Mathematics\n- 2+ years of classroom teaching experience preferred\n- Strong knowledge of high school mathematics curriculum\n- Experience with educational technology tools (Google Classroom, Khan Academy)\n- Strong classroom management skills`,
    requiredSkills: ["Mathematics", "Curriculum Development", "Lesson Planning", "Student Assessment", "Google Classroom", "Differentiated Instruction", "Classroom Management"],
    experienceLevel: "MID",
    location: "Boston, MA (On-site)",
    salary: "$55,000 - $75,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@brightminds.edu",
    title: "School Counselor",
    description: `BrightMinds Education Group is hiring a School Counselor to support the academic, social-emotional, and career development of students in grades 9–12. You will develop counseling programs, provide individual and group sessions, and collaborate with teachers and parents.\n\nYou will play a vital role in creating a safe and supportive school climate for all students.`,
    requirements: `- Master's degree in School Counseling or related field\n- Valid state school counseling licensure\n- 2+ years of experience in a school counseling role\n- Strong knowledge of college admissions and career counseling\n- Experience with crisis intervention and mental health support\n- Experience with student information systems (Naviance, PowerSchool)`,
    requiredSkills: ["School Counseling", "Crisis Intervention", "College Advising", "Career Counseling", "Social-Emotional Learning", "Naviance", "PowerSchool"],
    experienceLevel: "MID",
    location: "Boston, MA (On-site)",
    salary: "$58,000 - $78,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@brightminds.edu",
    title: "Early Childhood Education Teacher",
    description: `BrightMinds Education Group is looking for a nurturing Early Childhood Education Teacher to work with children aged 3–5 in our Pre-K program. You will design and implement age-appropriate learning activities that promote cognitive, social, emotional, and physical development.`,
    requirements: `- Bachelor's degree in Early Childhood Education or Child Development\n- State certification or CDA credential\n- 1+ year of experience working with young children\n- Knowledge of developmentally appropriate practices (DAP)\n- Strong creativity, patience, and enthusiasm for young learners\n- Experience with play-based learning approaches`,
    requiredSkills: ["Early Childhood Education", "Child Development", "Lesson Planning", "Play-Based Learning", "Classroom Management", "Parent Communication"],
    experienceLevel: "JUNIOR",
    location: "Boston, MA (On-site)",
    salary: "$40,000 - $55,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // MARKETING & ADVERTISING
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@marketpulse.com",
    title: "Digital Marketing Manager",
    description: `MarketPulse Agency is seeking an experienced Digital Marketing Manager to lead clients' digital campaigns across SEO, SEM, social media, email, and content marketing. You will develop strategies, manage budgets, and deliver measurable results.\n\nYou will manage a team of specialists and act as the primary point of contact for key client accounts.`,
    requirements: `- 5+ years of digital marketing experience, preferably in an agency\n- Proven track record managing successful multi-channel campaigns\n- Proficiency with Google Ads, Meta Ads, and programmatic advertising\n- Strong SEO/SEM knowledge and experience with tools like SEMrush\n- Experience with marketing automation platforms (HubSpot, Marketo)\n- Google Ads and Meta certifications preferred`,
    requiredSkills: ["Google Ads", "Meta Ads", "SEO", "SEM", "HubSpot", "Email Marketing", "Content Strategy", "Analytics"],
    experienceLevel: "SENIOR",
    location: "Los Angeles, CA (Hybrid)",
    salary: "$90,000 - $115,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@marketpulse.com",
    title: "Graphic Designer",
    description: `MarketPulse Agency is looking for a talented Graphic Designer to create compelling visual content for clients across a wide range of industries. You will design materials for digital, print, and social media channels.\n\nA strong portfolio showcasing your range and creativity is essential.`,
    requirements: `- Bachelor's degree in Graphic Design or related field\n- 2+ years of professional graphic design experience\n- Expert proficiency in Adobe Creative Suite (Photoshop, Illustrator, InDesign)\n- Strong understanding of typography, color theory, and layout\n- Experience designing for both digital and print media\n- Motion graphics or video editing skills are a plus`,
    requiredSkills: ["Adobe Photoshop", "Adobe Illustrator", "InDesign", "Typography", "Brand Design", "Social Media Design", "Print Design"],
    experienceLevel: "JUNIOR",
    location: "Remote",
    salary: "$50,000 - $68,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@marketpulse.com",
    title: "Content Writer & Strategist",
    description: `MarketPulse Agency is hiring a skilled Content Writer & Strategist to produce high-quality content for blogs, websites, social media, email campaigns, and whitepapers across various client industries.\n\nYou will research topics in depth, develop content calendars, and ensure all content aligns with brand voice and SEO best practices.`,
    requirements: `- 3+ years of experience in content writing or content marketing\n- Excellent writing, editing, and proofreading skills\n- Strong understanding of SEO and content optimization\n- Experience developing content strategies and editorial calendars\n- Ability to write for diverse industries and audiences\n- Familiarity with CMS platforms (WordPress, Webflow)`,
    requiredSkills: ["Content Writing", "SEO Writing", "Content Strategy", "WordPress", "Editorial Calendar", "Copywriting", "Research", "Email Marketing"],
    experienceLevel: "MID",
    location: "Remote",
    salary: "$60,000 - $80,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // LEGAL
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@lexgroup.com",
    title: "Corporate Lawyer",
    description: `Lex Group Law Firm is seeking a highly capable Corporate Lawyer to advise clients on mergers and acquisitions, corporate governance, contract negotiations, and commercial transactions.\n\nYou will work with a diverse client base ranging from startups to Fortune 500 companies, providing strategic legal counsel and drafting complex legal documents.`,
    requirements: `- Juris Doctor (JD) degree from an accredited law school\n- Admission to the state bar (NY or DC preferred)\n- 5+ years of corporate law experience at a law firm or in-house\n- Deep knowledge of M&A transactions, corporate governance, and securities law\n- Exceptional drafting, negotiation, and analytical skills\n- Experience managing due diligence processes`,
    requiredSkills: ["Corporate Law", "M&A", "Contract Drafting", "Due Diligence", "Securities Law", "Corporate Governance", "Negotiation", "Legal Research"],
    experienceLevel: "SENIOR",
    location: "New York, NY (On-site)",
    salary: "$160,000 - $210,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@lexgroup.com",
    title: "Legal Assistant",
    description: `Lex Group Law Firm is hiring a detail-oriented Legal Assistant to support our attorneys with document preparation, legal research, scheduling, and case file management.\n\nThis is a great entry-level opportunity for someone looking to begin a career in law with exposure to a wide range of practice areas.`,
    requirements: `- Associate's or Bachelor's degree in Paralegal or Legal Studies\n- 1+ year of experience in a law firm or legal setting preferred\n- Proficiency in Microsoft Office Suite\n- Strong written and verbal communication skills\n- Excellent organizational and time management skills\n- Ability to handle confidential information with discretion\n- Familiarity with Westlaw or LexisNexis is a plus`,
    requiredSkills: ["Legal Research", "Document Preparation", "Case Management", "Microsoft Office", "Westlaw", "Legal Filing", "Communication"],
    experienceLevel: "ENTRY",
    location: "New York, NY (On-site)",
    salary: "$40,000 - $55,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@lexgroup.com",
    title: "Compliance Officer",
    description: `Lex Group Law Firm is looking for an experienced Compliance Officer to oversee the firm's compliance with legal regulations and internal policies. You will develop compliance programs, conduct audits, and ensure adherence to professional responsibility standards.`,
    requirements: `- Bachelor's or Master's degree in Law, Business, or Compliance\n- 4+ years of experience in legal or financial compliance\n- Deep knowledge of professional responsibility rules\n- Experience developing and implementing compliance programs\n- Strong investigative and analytical skills\n- Relevant certifications (CCEP, CRCM) preferred`,
    requiredSkills: ["Regulatory Compliance", "Risk Assessment", "Policy Development", "Internal Audit", "Legal Research", "GDPR", "AML", "Ethics"],
    experienceLevel: "MID",
    location: "New York, NY (Hybrid)",
    salary: "$85,000 - $110,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // MANUFACTURING & ENGINEERING
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@precisionmfg.com",
    title: "Mechanical Engineer",
    description: `Precision Manufacturing Co. is seeking a Mechanical Engineer to design, develop, and improve mechanical components and systems used in our industrial equipment manufacturing processes.\n\nYou will work from concept to production, collaborating with cross-functional teams to ensure designs meet quality, cost, and timeline requirements.`,
    requirements: `- Bachelor's degree in Mechanical Engineering\n- 3+ years of experience in product design or manufacturing engineering\n- Proficiency in CAD software (SolidWorks or AutoCAD)\n- Knowledge of GD&T and engineering drawing standards\n- Experience with manufacturing processes (CNC machining, injection molding)\n- Familiarity with FEA simulation tools`,
    requiredSkills: ["SolidWorks", "AutoCAD", "GD&T", "CNC Machining", "FEA", "Product Design", "Manufacturing Processes", "Lean Manufacturing"],
    experienceLevel: "MID",
    location: "Detroit, MI (On-site)",
    salary: "$80,000 - $105,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@precisionmfg.com",
    title: "Quality Control Inspector",
    description: `Precision Manufacturing Co. is hiring a Quality Control Inspector to ensure our manufactured products meet established quality standards and customer specifications.\n\nYou will inspect incoming materials, in-process production, and finished goods using precision measurement tools and document inspection results.`,
    requirements: `- High school diploma required; technical certificate or associate's degree preferred\n- 2+ years of quality control experience in a manufacturing environment\n- Proficiency with measurement tools (calipers, micrometers, CMM)\n- Knowledge of ISO 9001 quality management standards\n- Ability to read and interpret engineering drawings\n- Strong attention to detail and documentation skills`,
    requiredSkills: ["Quality Inspection", "CMM", "ISO 9001", "Statistical Process Control", "Engineering Drawings", "Measurement Tools", "Non-Conformance Reporting"],
    experienceLevel: "JUNIOR",
    location: "Detroit, MI (On-site)",
    salary: "$45,000 - $60,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@precisionmfg.com",
    title: "Production Supervisor",
    description: `Precision Manufacturing Co. is looking for an experienced Production Supervisor to oversee daily manufacturing operations on the shop floor. You will manage a team of 20–30 production workers, ensuring safety, quality, and productivity targets are met.\n\nYou will coordinate with engineering, maintenance, and quality teams to resolve production issues and drive continuous improvement.`,
    requirements: `- Bachelor's degree in Manufacturing or Industrial Engineering preferred\n- 5+ years of manufacturing experience with at least 2 years supervisory\n- Strong leadership and team management skills\n- Knowledge of Lean, Six Sigma, or other CI methodologies\n- Familiarity with ERP systems (SAP, Oracle)\n- OSHA safety certification preferred`,
    requiredSkills: ["Production Management", "Lean Manufacturing", "Six Sigma", "Team Leadership", "SAP", "OSHA", "Scheduling", "Continuous Improvement"],
    experienceLevel: "SENIOR",
    location: "Detroit, MI (On-site)",
    salary: "$85,000 - $110,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // RETAIL & CUSTOMER SERVICE
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@retailnation.com",
    title: "Store Manager",
    description: `RetailNation Inc. is looking for a dynamic Store Manager to oversee all operations of one of our flagship retail locations. You will drive sales, manage staff, control inventory, and deliver an exceptional customer experience.\n\nYou will lead a team of 30+ associates, develop talent, and implement corporate initiatives at the store level.`,
    requirements: `- 5+ years of retail management experience\n- Proven track record of meeting or exceeding sales targets\n- Strong leadership and people management skills\n- Experience with inventory management and loss prevention\n- Proficiency with POS systems and retail management software\n- Flexibility to work weekends, evenings, and holidays`,
    requiredSkills: ["Retail Management", "Sales Leadership", "Inventory Management", "POS Systems", "Team Development", "Customer Experience", "P&L Management"],
    experienceLevel: "SENIOR",
    location: "Dallas, TX (On-site)",
    salary: "$65,000 - $85,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@retailnation.com",
    title: "Customer Service Representative",
    description: `RetailNation Inc. is hiring enthusiastic Customer Service Representatives to assist customers in-store and via phone and chat. You will handle inquiries, process returns, resolve complaints, and ensure every customer leaves satisfied.\n\nThis is a great entry-level opportunity with growth paths into supervisory roles.`,
    requirements: `- High school diploma or equivalent\n- Previous customer service or retail experience preferred\n- Excellent communication and interpersonal skills\n- Patience and problem-solving ability\n- Basic computer proficiency\n- Ability to work flexible hours including weekends\n- Bilingual (English/Spanish) is a plus`,
    requiredSkills: ["Customer Service", "Communication", "Problem Solving", "POS Systems", "Conflict Resolution", "Teamwork"],
    experienceLevel: "ENTRY",
    location: "Dallas, TX (On-site)",
    salary: "$30,000 - $40,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@retailnation.com",
    title: "E-Commerce & Merchandising Specialist",
    description: `RetailNation Inc. is seeking an E-Commerce & Merchandising Specialist to manage our online product catalog, optimize listings, and support digital sales growth.\n\nYou will work closely with buying, marketing, and logistics teams to ensure products are accurately listed, well-merchandised, and effectively promoted online.`,
    requirements: `- Bachelor's degree in Marketing, Business, or related field\n- 2+ years of experience in e-commerce or digital merchandising\n- Proficiency with Shopify, Magento, or WooCommerce\n- Strong understanding of SEO for product listings\n- Experience with Google Analytics and e-commerce reporting\n- Strong organizational and project management skills`,
    requiredSkills: ["Shopify", "E-Commerce", "SEO", "Google Analytics", "Product Merchandising", "Inventory Management", "Digital Marketing", "Data Analysis"],
    experienceLevel: "MID",
    location: "Remote",
    salary: "$58,000 - $75,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // CONSTRUCTION & ENGINEERING
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@buildright.com",
    title: "Civil Engineer",
    description: `BuildRight Construction is seeking a Civil Engineer to plan, design, and oversee construction projects including commercial buildings, roads, bridges, and utilities. You will be involved from initial site assessment through project completion.\n\nYou will work closely with project managers, architects, and subcontractors to ensure projects are delivered safely, on time, and within budget.`,
    requirements: `- Bachelor's degree in Civil Engineering\n- Professional Engineer (PE) license preferred\n- 4+ years of civil engineering experience\n- Proficiency in AutoCAD Civil 3D\n- Knowledge of local building codes and regulatory requirements\n- Experience with stormwater management and grading design\n- Strong project management and communication skills`,
    requiredSkills: ["AutoCAD Civil 3D", "Site Design", "Structural Analysis", "Project Management", "Stormwater Management", "Building Codes", "AutoCAD"],
    experienceLevel: "MID",
    location: "Phoenix, AZ (On-site)",
    salary: "$85,000 - $110,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@buildright.com",
    title: "Construction Project Manager",
    description: `BuildRight Construction is looking for an experienced Construction Project Manager to lead large-scale commercial and residential construction projects from initiation to handover.\n\nYou will be responsible for scheduling, budgeting, subcontractor management, safety compliance, and client communication throughout the full project lifecycle.`,
    requirements: `- Bachelor's degree in Construction Management or Civil Engineering\n- PMP or CCM certification preferred\n- 6+ years of construction project management experience\n- Proven experience managing projects over $5M in value\n- Proficiency with Procore and MS Project\n- Strong knowledge of construction contracts (AIA, FIDIC)\n- OSHA 30 certification required`,
    requiredSkills: ["Project Management", "Procore", "Budgeting", "Scheduling", "Subcontractor Management", "OSHA", "Construction Contracts", "Risk Management"],
    experienceLevel: "SENIOR",
    location: "Phoenix, AZ (On-site)",
    salary: "$100,000 - $135,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@buildright.com",
    title: "Site Safety Officer",
    description: `BuildRight Construction is hiring a Site Safety Officer to develop, implement, and monitor safety programs across our active construction sites. You will conduct daily safety inspections, lead toolbox talks, investigate incidents, and ensure full OSHA compliance.\n\nYour work will protect our workforce and maintain our strong safety record.`,
    requirements: `- Bachelor's degree in Occupational Health & Safety or related field\n- OSHA 30 certification required; CSP certification preferred\n- 3+ years of safety experience on active construction sites\n- In-depth knowledge of OSHA construction standards (29 CFR 1926)\n- Experience conducting safety audits and incident investigations\n- First Aid/CPR certification required`,
    requiredSkills: ["OSHA Compliance", "Safety Audits", "Incident Investigation", "Risk Assessment", "Safety Training", "PPE Management", "Construction Safety", "First Aid"],
    experienceLevel: "MID",
    location: "Phoenix, AZ (On-site)",
    salary: "$70,000 - $90,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },

  // ══════════════════════════════════════════════════════
  // AGRICULTURE & ENVIRONMENT
  // ══════════════════════════════════════════════════════
  {
    hrEmail: "hr@greenearthfarms.com",
    title: "Agronomist",
    description: `Green Earth Farms is seeking a qualified Agronomist to advise on crop production, soil health, and sustainable farming practices across our 5,000-acre operations. You will conduct field assessments, analyze data, and develop recommendations to maximize yield while preserving land health.`,
    requirements: `- Bachelor's degree in Agronomy, Agriculture, or Plant Science (Master's preferred)\n- 3+ years of experience as an agronomist or crop consultant\n- Certified Crop Adviser (CCA) designation preferred\n- Strong knowledge of soil science, crop nutrition, and pest management\n- Experience with precision agriculture tools and GPS mapping\n- Familiarity with sustainable and organic farming practices`,
    requiredSkills: ["Soil Science", "Crop Management", "Precision Agriculture", "Pest Management", "GPS Mapping", "Sustainable Farming", "CCA Certification", "Data Analysis"],
    experienceLevel: "MID",
    location: "Fresno, CA (On-site)",
    salary: "$65,000 - $85,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@greenearthfarms.com",
    title: "Farm Operations Manager",
    description: `Green Earth Farms is looking for an experienced Farm Operations Manager to oversee day-to-day management including planting, irrigation, harvesting, equipment maintenance, and workforce management.\n\nYou will coordinate seasonal labor, manage budgets, ensure regulatory compliance, and implement best practices to improve efficiency and sustainability.`,
    requirements: `- Bachelor's degree in Agricultural Business or Farm Management\n- 5+ years of farm or agricultural operations management experience\n- Strong leadership and workforce management skills\n- Knowledge of irrigation systems, farm machinery, and crop production\n- Experience managing budgets and operational costs\n- Familiarity with food safety standards (GAP, FSMA)`,
    requiredSkills: ["Farm Management", "Irrigation Systems", "Team Leadership", "Budget Management", "Food Safety", "GAP Compliance", "Agricultural Operations", "Equipment Management"],
    experienceLevel: "SENIOR",
    location: "Fresno, CA (On-site)",
    salary: "$80,000 - $100,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
  {
    hrEmail: "hr@greenearthfarms.com",
    title: "Environmental Sustainability Coordinator",
    description: `Green Earth Farms is hiring an Environmental Sustainability Coordinator to lead our environmental stewardship programs. You will monitor environmental compliance, manage waste reduction initiatives, coordinate with regulatory agencies, and develop sustainability reports.\n\nThis is a mission-driven role for someone passionate about the intersection of agriculture and environmental conservation.`,
    requirements: `- Bachelor's degree in Environmental Science or Sustainability\n- 2+ years of experience in environmental compliance or sustainability\n- Knowledge of environmental regulations (EPA, state-level requirements)\n- Experience developing and tracking sustainability KPIs\n- Strong data collection, analysis, and report writing skills\n- Passion for sustainable agriculture and conservation`,
    requiredSkills: ["Environmental Compliance", "Sustainability Reporting", "EPA Regulations", "Carbon Accounting", "Data Analysis", "Stakeholder Engagement", "Waste Management", "GIS"],
    experienceLevel: "JUNIOR",
    location: "Fresno, CA (Hybrid)",
    salary: "$50,000 - $68,000/year",
    jobType: "Full-time",
    status: "ACTIVE",
  },
];

// ─── Seed Function ────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 Starting full platform seed...\n");

  // 1. Create HR users
  console.log("👤 Creating HR users...");
  const createdHRs = {};

  for (const hrData of hrUsers) {
    const hashedPassword = await bcrypt.hash(hrData.password, 12);
    const hr = await prisma.user.upsert({
      where: { email: hrData.email },
      update: {},
      create: { ...hrData, password: hashedPassword },
    });
    createdHRs[hrData.email] = hr;
    console.log(`   ✅ ${hr.name} — ${hr.company}`);
  }

  // 2. Create jobs
  console.log("\n💼 Creating jobs across all sectors...\n");

  const sectorLabels = {
    "hr@techcorp.com":          "🖥️  Technology",
    "hr@cityhealth.com":        "🏥  Healthcare & Medical",
    "hr@globalbank.com":        "💰  Finance & Banking",
    "hr@brightminds.edu":       "📚  Education",
    "hr@marketpulse.com":       "📣  Marketing & Advertising",
    "hr@lexgroup.com":          "⚖️   Legal",
    "hr@precisionmfg.com":      "🏭  Manufacturing",
    "hr@retailnation.com":      "🛒  Retail & Customer Service",
    "hr@buildright.com":        "🏗️  Construction",
    "hr@greenearthfarms.com":   "🌾  Agriculture & Environment",
  };

  let lastSector = "";
  for (const jobData of jobsData) {
    const { hrEmail, ...job } = jobData;
    const hr = createdHRs[hrEmail];

    if (sectorLabels[hrEmail] !== lastSector) {
      console.log(`  ${sectorLabels[hrEmail]}`);
      lastSector = sectorLabels[hrEmail];
    }

    await prisma.job.create({ data: { ...job, hrId: hr.id } });
    console.log(`     ✅ [${job.experienceLevel.padEnd(6)}] ${job.title}`);
  }

  // 3. Final summary
  const totalJobs = await prisma.job.count();
  const totalHRs  = await prisma.user.count({ where: { role: "HR" } });

  console.log("\n──────────────────────────────────────────────────────");
  console.log("✅  Seed completed successfully!\n");
  console.log(`📊  Summary:`);
  console.log(`    HR Accounts : ${totalHRs}`);
  console.log(`    Jobs Seeded : ${totalJobs}`);
  console.log(`    Sectors     : 10`);
  console.log("\n🔑  Test HR Credentials (all passwords: password123)");
  console.log("──────────────────────────────────────────────────────");
  console.log("    hr@techcorp.com          → TechCorp Solutions");
  console.log("    hr@cityhealth.com        → City Health Medical Center");
  console.log("    hr@globalbank.com        → Global Bank & Finance");
  console.log("    hr@brightminds.edu       → BrightMinds Education Group");
  console.log("    hr@marketpulse.com       → MarketPulse Agency");
  console.log("    hr@lexgroup.com          → Lex Group Law Firm");
  console.log("    hr@precisionmfg.com      → Precision Manufacturing Co.");
  console.log("    hr@retailnation.com      → RetailNation Inc.");
  console.log("    hr@buildright.com        → BuildRight Construction");
  console.log("    hr@greenearthfarms.com   → Green Earth Farms");
  console.log("──────────────────────────────────────────────────────\n");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });